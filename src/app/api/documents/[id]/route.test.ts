// Wiring tests for the authenticated document-download proxy. The route
// is the only path by which stored files reach a client, so the security
// contract matters: lookups are scoped to the signed-in user, a missing
// row, missing file, or malformed id is an indistinguishable 404, and
// every response carries nosniff + no-store. The byte-streaming itself is
// exercised by the browser smoke test; here we pin the headers and the
// 404 boundary.
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

// `documents.id` is a uuid column, so the route only reaches the repo
// for a well-formed id. Fixtures use a real UUIDv7 (what uuidv7Pk()
// generates) rather than a readable stand-in.
const DOC_ID = '0197f3c2-1f8a-7c3a-8f21-3a6d9b2c4e51';

// The handler only reads `req.url`, so a minimal stand-in is enough.
function req(url = `http://localhost/api/documents/${DOC_ID}`): NextRequest {
  return { url } as unknown as NextRequest;
}

function ctx(id: string = DOC_ID) {
  return { params: Promise.resolve({ id }) };
}

const DOC = {
  id: DOC_ID,
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
    await GET(req(), ctx());
    expect(mocks.getByIdForUser).toHaveBeenCalledWith('user-1', DOC_ID);
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
    const res = await GET(
      req(`http://localhost/api/documents/${DOC_ID}?disposition=inline`),
      ctx(),
    );
    expect((res.headers.get('Content-Disposition') ?? '').startsWith('inline;')).toBe(true);
  });

  // A uuid column rejects malformed input at the driver (22P02), so an
  // unvalidated id turned a typo'd URL into a 500. The route now answers
  // with the same 404 it uses for an unknown id.
  it.each([
    ['not a uuid at all', 'not-a-uuid'],
    ['a uuid with a trailing segment', `${DOC_ID}x`],
    ['an empty id', ''],
    ['a numeric id', '42'],
  ])('returns 404 without touching the repo for %s', async (_label, id) => {
    const res = await GET(req(), ctx(id));
    expect(res.status).toBe(404);
    expect(mocks.getByIdForUser).not.toHaveBeenCalled();
    // Indistinguishable from the unknown-row 404 — same body and headers.
    expect(await res.text()).toBe('Not found');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  // Postgres accepts uppercase uuid literals and compares them
  // case-insensitively, so the route passes the id through verbatim
  // rather than normalising it.
  it('accepts a mixed-case uuid and hands it to the repo unchanged', async () => {
    const mixed = '0197F3C2-1f8a-7C3A-8f21-3A6D9B2C4E51';
    mocks.getByIdForUser.mockResolvedValue(null);
    const res = await GET(req(), ctx(mixed));
    expect(mocks.getByIdForUser).toHaveBeenCalledWith('user-1', mixed);
    expect(res.status).toBe(404);
  });

  it('never looks up a document for an unauthenticated request', async () => {
    mocks.requireUser.mockRejectedValue(new Error('redirect'));
    await expect(GET(req(), ctx())).rejects.toThrow();
    expect(mocks.getByIdForUser).not.toHaveBeenCalled();
  });

  // Auth comes first, so a signed-out caller gets the redirect and learns
  // nothing about the id's shape. A hoisted guard would answer 404 here
  // without ever consulting the session.
  it('rejects an unauthenticated request before it validates the id', async () => {
    mocks.requireUser.mockRejectedValue(new Error('redirect'));
    await expect(GET(req(), ctx('not-a-uuid'))).rejects.toThrow();
    expect(mocks.getByIdForUser).not.toHaveBeenCalled();
  });
});
