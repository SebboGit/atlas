// Wiring tests for the authenticated document-download proxy. The route
// is the only path by which stored files reach a client, so the security
// contract matters: lookups are scoped to the signed-in user, a missing
// row or missing file is an indistinguishable 404, and every response
// carries nosniff + no-store. The byte-streaming itself is exercised by
// the browser smoke test; here we pin the headers and the 404 boundary.
//
// vi.mock is hoisted above imports, so the factories close over hoisted
// vi.fn() handles (same pattern as documents/actions.test.ts).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getByIdForUser: vi.fn(),
  getStorage: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  requireUser: mocks.requireUser,
}));

vi.mock('@/lib/documents/repo', () => ({
  getByIdForUser: mocks.getByIdForUser,
}));

// Keep the real StorageNotFoundError (the route does `instanceof` against
// it) and override only the storage factory.
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return { ...actual, getStorage: mocks.getStorage };
});

import type { NextRequest } from 'next/server';

import { StorageNotFoundError } from '@/lib/storage';

import { GET } from './route';

// The handler only reads `req.url`, so a minimal stand-in is enough.
function req(url = 'http://localhost/api/documents/doc-1'): NextRequest {
  return { url } as unknown as NextRequest;
}

function ctx(id = 'doc-1') {
  return { params: Promise.resolve({ id }) };
}

const DOC = {
  id: 'doc-1',
  userId: 'user-1',
  objectKey: '2026/05/abc.pdf',
  mime: 'application/pdf',
  bytes: 1234,
  originalName: 'Bordkarte Fübar.pdf', // non-ASCII → exercises RFC 5987 encoding
};

function oneByteStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array([1]));
      c.close();
    },
  });
}

function storageReturning(stream: ReadableStream<Uint8Array>) {
  mocks.getStorage.mockReturnValue({ get: vi.fn().mockResolvedValue(stream) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: 'user-1' });
});

describe('GET /api/documents/[id]', () => {
  it('scopes the document lookup to the authenticated user', async () => {
    // The actual cross-user enforcement is the WHERE user_id predicate in
    // getByIdForUser, exercised directly in documents/repo.test.ts. Here we
    // only assert the route hands it the authenticated user's id.
    mocks.getByIdForUser.mockResolvedValue(null);
    await GET(req(), ctx('doc-1'));
    expect(mocks.getByIdForUser).toHaveBeenCalledWith('user-1', 'doc-1');
  });

  it('returns 404 with nosniff + no-store when the row is absent', async () => {
    mocks.getByIdForUser.mockResolvedValue(null);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('returns 404 when the row exists but the file is gone', async () => {
    mocks.getByIdForUser.mockResolvedValue(DOC);
    mocks.getStorage.mockReturnValue({
      get: vi.fn().mockRejectedValue(new StorageNotFoundError('gone')),
    });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    // Byte-for-byte indistinguishable from the missing-row 404 above —
    // same headers and body, so a probe can't tell "no such document"
    // from "row exists, file vanished".
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.text()).toBe('Not found');
  });

  it('streams 200 with content type, length, attachment disposition, and nosniff', async () => {
    mocks.getByIdForUser.mockResolvedValue(DOC);
    storageReturning(oneByteStream());
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Length')).toBe('1234');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const cd = res.headers.get('Content-Disposition') ?? '';
    expect(cd.startsWith('attachment;')).toBe(true);
    expect(cd).toContain("filename*=UTF-8''"); // RFC 5987 for the non-ASCII name
  });

  it('honours ?disposition=inline', async () => {
    mocks.getByIdForUser.mockResolvedValue(DOC);
    storageReturning(oneByteStream());
    const res = await GET(req('http://localhost/api/documents/doc-1?disposition=inline'), ctx());
    expect((res.headers.get('Content-Disposition') ?? '').startsWith('inline;')).toBe(true);
  });

  it('never looks up a document for an unauthenticated request', async () => {
    mocks.requireUser.mockRejectedValue(new Error('redirect'));
    await expect(GET(req(), ctx())).rejects.toThrow();
    expect(mocks.getByIdForUser).not.toHaveBeenCalled();
  });
});
