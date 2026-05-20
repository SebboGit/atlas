import { NextResponse, type NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth/session';
import * as documentsRepo from '@/lib/documents/repo';
import { getStorage, StorageNotFoundError } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

// Common security headers applied to every response from this route.
// Nothing here is ever cached publicly: documents are user-scoped and
// the bytes themselves can change MIME interpretation if mis-sniffed.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'private, no-store',
} as const;

// RFC 5987 filename* encoding so the original filename survives any
// non-ASCII characters in the download dialog. The plain `filename=` is
// also set as a fallback for old clients that don't read filename*.
function encodeFilenameStar(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// Authenticated document download proxy. Looks up the Document row by
// id, scoped to the requesting user, and streams the underlying file
// from storage. Never exposes the on-disk path or storage key.
export async function GET(req: NextRequest, ctx: RouteContext) {
  const user = await requireUser();
  const { id } = await ctx.params;

  const doc = await documentsRepo.getByIdForUser(user.id, id);
  if (!doc) {
    return new NextResponse('Not found', { status: 404, headers: SECURITY_HEADERS });
  }

  const url = new URL(req.url);
  const disposition = url.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';

  const storage = getStorage();
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await storage.get(doc.objectKey);
  } catch (e) {
    if (e instanceof StorageNotFoundError) {
      // Row exists, file doesn't. Treat as not found from the client's
      // perspective; the periodic sweep will eventually reconcile.
      return new NextResponse('Not found', { status: 404, headers: SECURITY_HEADERS });
    }
    throw e;
  }

  return new NextResponse(stream, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': doc.mime,
      'Content-Length': String(doc.bytes),
      'Content-Disposition': `${disposition}; ${encodeFilenameStar(doc.originalName)}`,
    },
  });
}
