import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { PdfTextExtractor } from './pdf-text';
import { MIN_USEFUL_CHARS } from './types';

// Tests run with cwd = project root (vitest invocation point), so we
// can address the committed fixtures directly. No __dirname / import.meta
// gymnastics needed.
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

describe('PdfTextExtractor', () => {
  it('canHandle: true for application/pdf, false otherwise', () => {
    const e = new PdfTextExtractor();
    expect(e.canHandle('application/pdf')).toBe(true);
    expect(e.canHandle('image/png')).toBe(false);
    expect(e.canHandle('text/plain')).toBe(false);
    expect(e.canHandle('')).toBe(false);
  });

  it('extracts text from a PDF with a real text layer', async () => {
    const { stream, bytes } = await loadFixture('text-pdf.pdf');
    const e = new PdfTextExtractor();

    const result = await e.extract({ stream, mime: 'application/pdf', bytes });

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.method).toBe('pdf-text');
    expect(result.confidence).toBe(1);
    expect(result.text.length).toBeGreaterThanOrEqual(MIN_USEFUL_CHARS);
    // Spot-check that one of the strings we put into the fixture
    // round-trips. Avoid hard-coding the exact spacing pdfjs hands
    // back — text-layer item ordering is parser-dependent.
    expect(result.text).toContain('BA287');
    expect(result.text).toContain('DOE/JANE');
  });

  it('returns null for a PDF with no text layer (image-only)', async () => {
    const { stream, bytes } = await loadFixture('image-only.pdf');
    const e = new PdfTextExtractor();

    const result = await e.extract({ stream, mime: 'application/pdf', bytes });

    expect(result).toBeNull();
  });

  it('returns null for garbage bytes without throwing', async () => {
    const buf = Buffer.from('this is definitely not a pdf', 'utf8');
    const e = new PdfTextExtractor();

    const result = await e.extract({
      stream: bufferToWebStream(buf),
      mime: 'application/pdf',
      bytes: buf.byteLength,
    });

    expect(result).toBeNull();
  });

  it('returns null for an empty stream without throwing', async () => {
    const e = new PdfTextExtractor();

    const result = await e.extract({
      stream: bufferToWebStream(Buffer.alloc(0)),
      mime: 'application/pdf',
      bytes: 0,
    });

    expect(result).toBeNull();
  });
});
