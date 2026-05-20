// End-to-end pipeline tests for the extraction slice.
//
// Unlike `orchestrator.test.ts` (pure unit tests with fake extractors),
// this suite exercises the *real* TextExtractor and DirectExtractor
// lineups against committed fixtures. The only fake is the LLM — we
// substitute a deterministic `LLMExtractor` so the test is hermetic
// (no Ollama process required) but every other seam is the production
// one.
//
// What this catches that the unit suite misses:
//   - Wiring drift between getDefaultExtractors() ordering and what the
//     orchestrator actually invokes (e.g. someone reorders the array
//     and pdf-text stops being tried first).
//   - Mismatch between the text method an extractor reports and the
//     value the orchestrator forwards in `textMethod`.
//   - A new fixture format silently bypassing the direct/text branches
//     and falling through to `all-extractors-failed`.
//   - Direct extractors accidentally being skipped past — the pkpass
//     case asserts the LLM was never called, not just that it returned ok.
//
// The fake Storage maps `objectKey` 1:1 to a file under
// tests/fixtures/extraction/. No real `FilesystemStorage` is loaded.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { getDefaultExtractors } from '@/lib/ocr';
import type { Storage } from '@/lib/storage';

import { extractDocument, type ExtractDocumentInput, getDefaultDirectExtractors } from './index';
import type { LLMExtractor, StructuredPayload } from './types';

// ---------------------------------------------------------------------------
// Fixtures + Storage stub
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.resolve(process.cwd(), 'tests/fixtures/extraction');

function bufferToWebStream(buf: Buffer): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(buf)) as unknown as ReadableStream<Uint8Array>;
}

/**
 * Builds a tiny fake Storage that returns the file at
 * `tests/fixtures/extraction/<key>` for each `get(key)` call. A fresh
 * stream is produced every time so the orchestrator's re-fetch-per-
 * extractor pattern works correctly.
 *
 * `put`/`stat`/`delete`/`url` throw if invoked — extraction must never
 * touch them. The throws turn an unexpected use into a loud failure
 * rather than a silent test pass.
 */
function fixtureStorage(): Storage {
  return {
    async get(key: string): Promise<ReadableStream<Uint8Array>> {
      const buf = await readFile(path.join(FIXTURE_DIR, key));
      return bufferToWebStream(buf);
    },
    put: vi.fn(() => {
      throw new Error('Storage.put should not be called during extraction');
    }),
    stat: vi.fn(() => {
      throw new Error('Storage.stat should not be called during extraction');
    }),
    delete: vi.fn(() => {
      throw new Error('Storage.delete should not be called during extraction');
    }),
    url: vi.fn(() => {
      throw new Error('Storage.url should not be called during extraction');
    }),
  } as unknown as Storage;
}

// File sizes — declared so the orchestrator's `bytes` field matches the
// real file. Kept as a constant rather than fs.stat()'d at import time
// to keep this file synchronous at module scope.
async function fixtureBytes(name: string): Promise<number> {
  const buf = await readFile(path.join(FIXTURE_DIR, name));
  return buf.byteLength;
}

/**
 * Build a deterministic fake LLM that captures every prompt it was
 * given. Each test can:
 *   - assert the LLM was called (text-ladder path) or NOT called
 *     (direct-extractor path),
 *   - inspect the captured text (e.g. that the pdf-text result reached
 *     it intact),
 *   - return a known StructuredPayload so the orchestrator emits
 *     `sourceMethod: 'llm-local'` with predictable fields.
 */
function fakeLlm(output: StructuredPayload | null): LLMExtractor & {
  calls: { text: string }[];
} {
  const calls: { text: string }[] = [];
  return {
    calls,
    async structure(text) {
      calls.push({ text });
      return output;
    },
  };
}

const BOARDING_OK: StructuredPayload = {
  kind: 'boarding-pass',
  flights: [
    {
      carrier: 'BA',
      flightNumber: '287',
      flightDate: '2026-06-01',
      scheduledDeparture: null,
      scheduledArrival: null,
      origin: 'LHR',
      destination: 'SFO',
      passengerName: 'DOE/JANE',
      confirmationCode: 'ABC123',
    },
  ],
  confidence: 0.9,
};

const HOTEL_OK: StructuredPayload = {
  kind: 'hotel-confirmation',
  hotelName: 'Hotel California',
  checkIn: '2026-06-01',
  checkOut: '2026-06-05',
  address: '1 Sunset Blvd, Los Angeles, CA',
  confirmationCode: 'CONF-9',
  country: 'US',
  confidence: 0.85,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extraction pipeline (real extractors + fake LLM)', () => {
  it('text-PDF → pdf-text extractor → fake LLM → llm-local', async () => {
    const bytes = await fixtureBytes('text-pdf.pdf');
    const input: ExtractDocumentInput = {
      objectKey: 'text-pdf.pdf',
      mime: 'application/pdf',
      bytes,
    };
    const llm = fakeLlm(BOARDING_OK);

    const result = await extractDocument(input, {
      storage: fixtureStorage(),
      llm,
      extractors: getDefaultExtractors(),
      directExtractors: getDefaultDirectExtractors(),
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.sourceMethod).toBe('llm-local');
    expect(result.textMethod).toBe('pdf-text');
    expect(result.parsed).toEqual(BOARDING_OK);
    expect(result.charsExtracted).toBeGreaterThan(0);

    // The LLM was called once with the pdf-text output. Spot-check the
    // content rather than the exact string — pdfjs's spacing isn't
    // worth pinning down.
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.text).toContain('BA287');
  });

  it('pkpass → direct extractor → LLM never called → pkpass', async () => {
    const bytes = await fixtureBytes('boarding.pkpass');
    const input: ExtractDocumentInput = {
      objectKey: 'boarding.pkpass',
      mime: 'application/vnd.apple.pkpass',
      bytes,
    };
    const llm = fakeLlm(BOARDING_OK); // would-be value; should never be used

    const result = await extractDocument(input, {
      storage: fixtureStorage(),
      llm,
      extractors: getDefaultExtractors(),
      directExtractors: getDefaultDirectExtractors(),
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.sourceMethod).toBe('pkpass');
    // textMethod MUST be null when a direct extractor produced the payload —
    // the audit story in the documents.parsedBy/textMethod pair depends on it.
    expect(result.textMethod).toBeNull();
    expect(result.charsExtracted).toBe(0);
    // Pkpass produces a real BoardingPassPayload from the fixture's
    // pass.json. We don't pin the exact carrier/flight here — that's
    // covered by pkpass.test.ts — only that *something* shaped like one
    // came back.
    expect(result.parsed.kind).toBe('boarding-pass');

    // The whole point of the direct-extractor short-circuit: the LLM
    // must not have been called.
    expect(llm.calls).toHaveLength(0);
  });

  it('multipart .eml → eml extractor → fake LLM → email', async () => {
    const bytes = await fixtureBytes('multipart.eml');
    const input: ExtractDocumentInput = {
      objectKey: 'multipart.eml',
      mime: 'message/rfc822',
      bytes,
    };
    const llm = fakeLlm(HOTEL_OK);

    const result = await extractDocument(input, {
      storage: fixtureStorage(),
      llm,
      extractors: getDefaultExtractors(),
      directExtractors: getDefaultDirectExtractors(),
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.sourceMethod).toBe('llm-local');
    expect(result.textMethod).toBe('email');
    expect(result.parsed).toEqual(HOTEL_OK);

    // The LLM saw the plain-text body the eml extractor chose, with
    // subject prepended. Plain-text marker present; HTML marker excluded.
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.text).toContain('PLAIN-MARKER');
    expect(llm.calls[0]?.text).not.toContain('HTML-MARKER');
  });

  it('image-only PDF (no rasterization yet) → all-extractors-failed → LLM never called', async () => {
    // The PdfTextExtractor returns null for an image-only PDF, and the
    // current lineup has no rasterize-and-OCR path for PDFs — Tesseract
    // canHandle() is image-MIME only. The orchestrator must give up
    // before calling the LLM (no text to structure).
    const bytes = await fixtureBytes('image-only.pdf');
    const input: ExtractDocumentInput = {
      objectKey: 'image-only.pdf',
      mime: 'application/pdf',
      bytes,
    };
    const llm = fakeLlm(BOARDING_OK);

    const result = await extractDocument(input, {
      storage: fixtureStorage(),
      llm,
      extractors: getDefaultExtractors(),
      directExtractors: getDefaultDirectExtractors(),
    });

    expect(result).toEqual({ status: 'failed', reason: 'all-extractors-failed' });
    expect(llm.calls).toHaveLength(0);
  });
});
