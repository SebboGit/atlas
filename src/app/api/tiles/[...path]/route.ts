// Tile streamer for self-hosted PMTiles basemap. See ADR-0011.
//
// The PMTiles format is a single file with an internal index — the
// client (`pmtiles` JS library) issues HTTP Range requests against
// this endpoint for the header + each individual tile. This route
// reads bytes from disk under TILES_DIR and serves them with proper
// 206 Partial Content + Content-Range semantics so the byte-range
// machinery works in any modern browser.
//
// No auth gate — tiles are visual basemap data, identical for every
// user, no privacy boundary. Same-origin only via Next.js defaults;
// no CORS headers are emitted.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Resolved once at module load. Default mirrors the storage adapter
// convention (project-relative for `pnpm dev`; docker-compose
// overrides to the absolute container path).
const TILES_ROOT = path.resolve(process.env.TILES_DIR ?? './data/tiles');

type RouteContext = { params: Promise<{ path: string[] }> };

// Always-on response headers — independent of cache state. Range
// support, MIME-sniff protection. Cache-Control is layered on per
// response since 200s want long-lived caching with revalidation and
// 404s want no caching at all so a `pnpm tiles:fetch` recovery
// propagates immediately.
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Accept-Ranges': 'bytes',
} as const;

// Tiles are content-addressable enough that a long max-age is safe;
// `must-revalidate` makes the browser revalidate against ETag /
// Last-Modified on every expiry, so a fresh `pnpm tiles:fetch`
// propagates as soon as the cache window rolls over instead of
// requiring a hard-refresh.
const FOUND_CACHE = 'public, max-age=86400, must-revalidate';
// 404 must never linger — an operator who forgets to run
// `pnpm tiles:fetch` and then runs it should recover immediately,
// not after the cache window expires.
const MISS_CACHE = 'no-store';

// Pure helpers exported for tests.

export function buildValidators(stats: { size: number; mtimeMs: number; mtime: Date }): {
  etag: string;
  lastModified: string;
} {
  // Weak ETag from size + mtime (millisecond-precision). Stable
  // enough — PMTiles is a single-writer scenario, no second process
  // is rewriting the file under us. Hex keeps the header short.
  const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
  const lastModified = stats.mtime.toUTCString();
  return { etag, lastModified };
}

export type ParsedRange =
  | { kind: 'ok'; start: number; end: number }
  | { kind: 'invalid' }
  | { kind: 'absent' };

// Parses an RFC 7233 single-range Byte-Range Request and clamps the
// end to `total - 1` per §2.1 (an inclusive last-byte-pos at or
// past the resource length is interpreted as the remainder of the
// representation, not a 416). Returns `'absent'` when no Range
// header was provided so the caller can fall through to the full
// response.
export function parseRange(rangeHeader: string | null, total: number): ParsedRange {
  if (rangeHeader === null) return { kind: 'absent' };
  // Multi-range and other unit specifiers aren't supported — pmtiles
  // never sends them and the multipart/byteranges response semantics
  // aren't worth the surface.
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return { kind: 'invalid' };
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : total - 1;
  if (Number.isNaN(start) || Number.isNaN(requestedEnd)) return { kind: 'invalid' };
  // Empty file → no satisfiable range. `start >= total` is the
  // remaining-bytes guard once `end` is clamped.
  if (total === 0 || start >= total) return { kind: 'invalid' };
  const end = Math.min(requestedEnd, total - 1);
  if (start > end) return { kind: 'invalid' };
  return { kind: 'ok', start, end };
}

function notModified(etag: string, lastModified: string): NextResponse {
  // 304 must echo the validators back so the client can keep its
  // cache entry hot. Don't include Content-Type / Content-Length —
  // RFC 7232 forbids a body on 304.
  return new NextResponse(null, {
    status: 304,
    headers: {
      ETag: etag,
      'Last-Modified': lastModified,
      'Cache-Control': FOUND_CACHE,
      ...BASE_HEADERS,
    },
  });
}

// Match an `If-None-Match` header against our weak ETag. The header
// may carry `*` (match any) or a comma-separated list. Weak ETags
// compare per RFC 7232 §2.3.2 — our values include the `W/` prefix
// already, so equality works.
function ifNoneMatchMatches(headerValue: string, etag: string): boolean {
  const trimmed = headerValue.trim();
  if (trimmed === '*') return true;
  for (const candidate of trimmed.split(',')) {
    if (candidate.trim() === etag) return true;
  }
  return false;
}

// Exported for tests. Resolves the request path under TILES_ROOT and
// rejects traversal / null-byte attempts. Returns `null` on rejection
// so the route can emit a clean 400 without leaking the reason.
export function resolveTilePath(segments: ReadonlyArray<string>): string | null {
  if (segments.length === 0) return null;
  for (const s of segments) {
    if (s.includes('\0')) return null;
    if (s === '..' || s === '.') return null;
    if (s.startsWith('/')) return null;
  }
  const resolved = path.resolve(TILES_ROOT, ...segments);
  // Containment check belt-and-braces the per-segment filtering above
  // against any path.resolve quirk we didn't anticipate.
  if (resolved !== TILES_ROOT && !resolved.startsWith(TILES_ROOT + path.sep)) {
    return null;
  }
  return resolved;
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.pmtiles')) return 'application/octet-stream';
  if (filePath.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function notFound(): NextResponse {
  return new NextResponse('Not found', {
    status: 404,
    headers: { 'Cache-Control': MISS_CACHE, ...BASE_HEADERS },
  });
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { path: segments } = await ctx.params;

  const resolved = resolveTilePath(segments);
  if (resolved === null) {
    return new NextResponse('Bad request', { status: 400 });
  }

  let stats;
  try {
    stats = await stat(resolved);
  } catch {
    return notFound();
  }
  if (!stats.isFile()) return notFound();

  const { etag, lastModified } = buildValidators(stats);

  // Conditional GET — short-circuit before reading any bytes. If-
  // None-Match wins per RFC 7232 §6 when both are present.
  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatchMatches(ifNoneMatch, etag)) {
    return notModified(etag, lastModified);
  }
  if (!ifNoneMatch) {
    const ifModifiedSince = req.headers.get('if-modified-since');
    if (ifModifiedSince) {
      const since = Date.parse(ifModifiedSince);
      // HTTP-date is second-precision; compare with mtime floored
      // to the same precision so a sub-second mtime tick doesn't
      // spuriously invalidate.
      if (!Number.isNaN(since) && Math.floor(stats.mtimeMs / 1000) * 1000 <= since) {
        return notModified(etag, lastModified);
      }
    }
  }

  const total = stats.size;
  const range = parseRange(req.headers.get('range'), total);
  if (range.kind === 'invalid') {
    return new NextResponse('Range Not Satisfiable', {
      status: 416,
      headers: {
        'Content-Range': `bytes */${total}`,
        'Cache-Control': MISS_CACHE,
        ...BASE_HEADERS,
      },
    });
  }

  // Default (no Range): full file. With Range: 206 + Content-Range.
  const start = range.kind === 'ok' ? range.start : 0;
  const end = range.kind === 'ok' ? range.end : total - 1;
  const status = range.kind === 'ok' ? 206 : 200;
  const rangeResponseHeader: Record<string, string> =
    range.kind === 'ok' ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {};

  const nodeStream = createReadStream(resolved, { start, end });
  // Node 18+ Readable.toWeb — the supported Node → web stream bridge.
  // Cast through unknown because the typing returns
  // ReadableStream<unknown> rather than ReadableStream<Uint8Array>.
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    status,
    headers: {
      'Content-Type': contentTypeFor(resolved),
      'Content-Length': String(end - start + 1),
      'Cache-Control': FOUND_CACHE,
      ETag: etag,
      'Last-Modified': lastModified,
      ...BASE_HEADERS,
      ...rangeResponseHeader,
    },
  });
}
