import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { TesseractOcr } from './ocr-tesseract';

// Tesseract.js downloads ~10MB of English language data on first run.
// We don't want that pulling in every CI invocation, so the slow test
// path is opt-in via RUN_TESSERACT_TESTS=1. The cheap structural tests
// (canHandle, unsupported MIME bailout) always run.
const RUN_REAL_OCR = process.env.RUN_TESSERACT_TESTS === '1';

const FIXTURE_DIR = path.resolve(process.cwd(), 'tests/fixtures/extraction');

function bufferToWebStream(buf: Buffer): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(buf)) as unknown as ReadableStream<Uint8Array>;
}

describe('TesseractOcr', () => {
  it('canHandle: true for supported image MIMEs', () => {
    const e = new TesseractOcr();
    expect(e.canHandle('image/png')).toBe(true);
    expect(e.canHandle('image/jpeg')).toBe(true);
    expect(e.canHandle('image/webp')).toBe(true);
  });

  it('canHandle: false for PDFs (deferred to a future render-and-OCR path)', () => {
    const e = new TesseractOcr();
    expect(e.canHandle('application/pdf')).toBe(false);
  });

  it('canHandle: false for unsupported MIMEs', () => {
    const e = new TesseractOcr();
    expect(e.canHandle('text/plain')).toBe(false);
    expect(e.canHandle('application/octet-stream')).toBe(false);
    expect(e.canHandle('')).toBe(false);
  });

  it('extract: returns null for an unsupported MIME without running the engine', async () => {
    const e = new TesseractOcr();
    const result = await e.extract({
      stream: bufferToWebStream(Buffer.from([0])),
      mime: 'application/pdf',
      bytes: 1,
    });
    expect(result).toBeNull();
  });

  // The "real" OCR path is gated. When it runs, it spins up tesseract.js
  // against the committed PNG fixture and asserts the recognised text
  // contains the word we baked into the image.
  describe.skipIf(!RUN_REAL_OCR)('with RUN_TESSERACT_TESTS=1', () => {
    it('extracts the word "BOARDING" from the fixture PNG', async () => {
      const buf = await readFile(path.join(FIXTURE_DIR, 'boarding-image.png'));
      const e = new TesseractOcr();

      const result = await e.extract({
        stream: bufferToWebStream(buf),
        mime: 'image/png',
        bytes: buf.byteLength,
      });

      expect(result).not.toBeNull();
      if (!result) return;

      expect(result.method).toBe('ocr-tesseract');
      // Confidence is normalised into 0–1.
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      // Tesseract output sometimes has trailing newlines or spacing
      // variations; normalise to upper-case before searching.
      expect(result.text.toUpperCase()).toContain('BOARDING');
    }, // it downloads language data. // Tesseract cold-starts can take well over 30s on first run as
    60_000);
  });
});
