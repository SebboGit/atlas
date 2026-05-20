import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { EML_MIME, EmlExtractor, stripHtml } from './eml';
import { MIN_USEFUL_CHARS } from './types';

const FIXTURE_DIR = path.resolve(process.cwd(), 'tests/fixtures/extraction');

function bufferToWebStream(buf: Buffer): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(buf)) as unknown as ReadableStream<Uint8Array>;
}

async function loadFixture(
  name: string,
): Promise<{ stream: ReadableStream<Uint8Array>; bytes: number }> {
  const buf = await readFile(path.join(FIXTURE_DIR, name));
  return { stream: bufferToWebStream(buf), bytes: buf.byteLength };
}

describe('EmlExtractor', () => {
  it('canHandle: true for message/rfc822 only', () => {
    const e = new EmlExtractor();
    expect(e.canHandle(EML_MIME)).toBe(true);
    expect(e.canHandle('application/pdf')).toBe(false);
    expect(e.canHandle('text/plain')).toBe(false);
    expect(e.canHandle('')).toBe(false);
  });

  it('prefers the text/plain part of a multipart/alternative message', async () => {
    const { stream, bytes } = await loadFixture('multipart.eml');
    const e = new EmlExtractor();

    const result = await e.extract({ stream, mime: EML_MIME, bytes });

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.method).toBe('email');
    expect(result.confidence).toBe(1);
    // Subject is prepended.
    expect(result.text.startsWith('Subject: Your hotel reservation is confirmed')).toBe(true);
    // Plain-text marker is present; HTML-only marker is NOT.
    expect(result.text).toContain('PLAIN-MARKER');
    expect(result.text).not.toContain('HTML-MARKER');
  });

  it('falls back to stripping HTML when only text/html is present', async () => {
    const { stream, bytes } = await loadFixture('html-only.eml');
    const e = new EmlExtractor();

    const result = await e.extract({ stream, mime: EML_MIME, bytes });

    expect(result).not.toBeNull();
    if (!result) return;
    // Subject prepended, useful content present, HTML scaffolding gone.
    expect(result.text).toContain('Subject: Boarding pass');
    expect(result.text).toContain('BA287');
    expect(result.text).toContain('LHR');
    expect(result.text).toContain('SFO');
    expect(result.text).toContain('Jane Doe');
    // The <style> block content is gone.
    expect(result.text).not.toContain('font-family');
    expect(result.text).not.toContain('display:none');
    // <script> content gone.
    expect(result.text).not.toContain('tracking()');
    // Tags themselves gone.
    expect(result.text).not.toMatch(/<[a-z][^>]*>/i);
    // Entity decoded.
    expect(result.text).toContain('→');
  });

  it('returns null for garbage / non-MIME bytes without throwing', async () => {
    const { stream, bytes } = await loadFixture('malformed.eml');
    const e = new EmlExtractor();

    // Postal-mime is lenient: it'll happily "parse" a string that
    // doesn't look like a MIME message and return an empty body. The
    // extractor should treat the empty body as "useless" and return
    // null rather than emitting a degenerate ExtractedText.
    const result = await e.extract({ stream, mime: EML_MIME, bytes });

    expect(result).toBeNull();
  });

  it('returns null when the composed text is shorter than MIN_USEFUL_CHARS', async () => {
    // Construct a tiny multipart with a minimal subject + body.
    const tiny = [
      'Subject: hi',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'ok',
      '',
    ].join('\r\n');
    const buf = Buffer.from(tiny, 'utf8');
    const e = new EmlExtractor();

    const result = await e.extract({
      stream: bufferToWebStream(buf),
      mime: EML_MIME,
      bytes: buf.byteLength,
    });

    // "Subject: hi\n\nok" → 15 chars, comfortably below 32.
    expect(result).toBeNull();
    // Sanity check on the threshold so this test stays meaningful if
    // the threshold ever shifts.
    expect(MIN_USEFUL_CHARS).toBeGreaterThan(15);
  });

  it('returns null for an empty stream without throwing', async () => {
    const e = new EmlExtractor();
    const result = await e.extract({
      stream: bufferToWebStream(Buffer.alloc(0)),
      mime: EML_MIME,
      bytes: 0,
    });
    expect(result).toBeNull();
  });
});

describe('stripHtml', () => {
  it('removes <script> and <style> blocks including their contents', () => {
    const html =
      '<html><head><style>body{color:red}.x{display:none}</style></head>' +
      '<body><script>alert(1)</script>visible</body></html>';
    const out = stripHtml(html);
    expect(out).toContain('visible');
    expect(out).not.toContain('color:red');
    expect(out).not.toContain('alert');
  });

  it('removes HTML comments including conditional ones', () => {
    const html = '<p>hello<!--[if mso]><style>x{}</style><![endif]-->world</p>';
    expect(stripHtml(html)).not.toContain('mso');
    expect(stripHtml(html)).toContain('hello');
    expect(stripHtml(html)).toContain('world');
  });

  it('inserts newlines at block boundaries and collapses whitespace', () => {
    const html = '<p>one</p><p>two</p><br><p>three</p>';
    const out = stripHtml(html);
    expect(
      out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    ).toEqual(['one', 'two', 'three']);
  });

  it('decodes common named, numeric, and hex entities', () => {
    expect(stripHtml('a&amp;b')).toBe('a&b');
    expect(stripHtml('&nbsp;x&nbsp;')).toContain('x');
    expect(stripHtml('a&#39;b')).toBe("a'b");
    expect(stripHtml('&#x2192;')).toBe('→');
  });

  it('passes through plain text unchanged (modulo trim)', () => {
    expect(stripHtml('hello world')).toBe('hello world');
  });

  it('handles empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});
