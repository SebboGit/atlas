// Tests for the path-resolution gate in the tile route. The route's
// streaming behaviour is exercised by the browser smoke test
// (loading the trip-detail map and watching `pmtiles` make range
// requests); these tests pin down the security boundary — what
// requests get rejected before any filesystem read.
//
// Expected paths are computed from the module's actual TILES_ROOT
// (project-relative default `./data/tiles` unless TILES_DIR is set
// at process start). Avoids brittle hardcoded paths under different
// CWDs.

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildValidators, parseRange, resolveTilePath } from './route';

const ROOT = path.resolve(process.env.TILES_DIR ?? './data/tiles');

describe('resolveTilePath — safety', () => {
  it('returns null for an empty segments array', () => {
    expect(resolveTilePath([])).toBeNull();
  });

  it('rejects ".." segments (traversal)', () => {
    expect(resolveTilePath(['..', 'etc', 'passwd'])).toBeNull();
    expect(resolveTilePath(['world.pmtiles', '..', '..', 'etc'])).toBeNull();
  });

  it('rejects "." segments', () => {
    expect(resolveTilePath(['.', 'world.pmtiles'])).toBeNull();
  });

  it('rejects null bytes in any segment', () => {
    expect(resolveTilePath(['world.pmtiles\0evil'])).toBeNull();
  });

  it('rejects absolute-path segments', () => {
    expect(resolveTilePath(['/etc/passwd'])).toBeNull();
  });

  it('accepts a plain filename under the root', () => {
    expect(resolveTilePath(['world.pmtiles'])).toBe(path.join(ROOT, 'world.pmtiles'));
  });

  it('accepts a nested filename under the root', () => {
    expect(resolveTilePath(['region', 'europe.pmtiles'])).toBe(
      path.join(ROOT, 'region', 'europe.pmtiles'),
    );
  });
});

describe('parseRange', () => {
  const TOTAL = 1000;

  it('reports absent when no Range header is supplied', () => {
    expect(parseRange(null, TOTAL)).toEqual({ kind: 'absent' });
  });

  it('parses a fully-specified range', () => {
    expect(parseRange('bytes=0-99', TOTAL)).toEqual({ kind: 'ok', start: 0, end: 99 });
    expect(parseRange('bytes=100-199', TOTAL)).toEqual({ kind: 'ok', start: 100, end: 199 });
  });

  it('treats an open-ended range as "to last byte"', () => {
    expect(parseRange('bytes=500-', TOTAL)).toEqual({ kind: 'ok', start: 500, end: 999 });
  });

  it('clamps end past total-1 to total-1 (RFC 7233 §2.1)', () => {
    // The pre-fix behaviour rejected this with 416 — now we accept
    // and serve up to the resource's last byte.
    expect(parseRange('bytes=0-99999', TOTAL)).toEqual({ kind: 'ok', start: 0, end: 999 });
  });

  it('rejects ranges whose start is at or past total', () => {
    expect(parseRange('bytes=1000-1500', TOTAL)).toEqual({ kind: 'invalid' });
    expect(parseRange('bytes=1500-', TOTAL)).toEqual({ kind: 'invalid' });
  });

  it('rejects reversed ranges and malformed inputs', () => {
    expect(parseRange('bytes=100-50', TOTAL)).toEqual({ kind: 'invalid' });
    expect(parseRange('items=0-99', TOTAL)).toEqual({ kind: 'invalid' });
    expect(parseRange('bytes=-', TOTAL)).toEqual({ kind: 'invalid' });
    expect(parseRange('garbage', TOTAL)).toEqual({ kind: 'invalid' });
  });

  it('rejects every range against an empty resource', () => {
    expect(parseRange('bytes=0-99', 0)).toEqual({ kind: 'invalid' });
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'invalid' });
  });

  it('tolerates whitespace around the header value', () => {
    expect(parseRange('  bytes=0-99  ', TOTAL)).toEqual({ kind: 'ok', start: 0, end: 99 });
  });
});

describe('buildValidators', () => {
  it('emits a weak ETag built from size and mtime, plus an RFC-compliant Last-Modified', () => {
    const mtime = new Date('2026-05-19T10:30:00.000Z');
    const { etag, lastModified } = buildValidators({
      size: 0x1234,
      mtimeMs: 0xabcd,
      mtime,
    });
    expect(etag).toBe('W/"1234-abcd"');
    expect(lastModified).toBe(mtime.toUTCString());
    expect(lastModified).toMatch(/GMT$/);
  });

  it('floors sub-millisecond mtime fractions before hex-encoding', () => {
    // stat returns mtimeMs as a float on some platforms; the ETag
    // must be deterministic across invocations that round trip
    // through HTTP-date precision, so we floor first.
    const { etag } = buildValidators({
      size: 10,
      mtimeMs: 1234.567,
      mtime: new Date(1234),
    });
    expect(etag).toBe('W/"a-4d2"');
  });
});
