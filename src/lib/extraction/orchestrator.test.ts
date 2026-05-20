import { describe, expect, it, vi } from 'vitest';

import type { ExtractedText, TextExtractor, TextExtractorInput } from '@/lib/ocr';
import type { Storage } from '@/lib/storage';

import type { DirectExtractor, DirectExtractorInput } from './direct';
import {
  type ExtractDocumentDeps,
  extractDocument,
  type ExtractDocumentInput,
} from './orchestrator';
import type { LLMExtractor, StructuredPayload } from './types';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const PDF_INPUT: ExtractDocumentInput = {
  objectKey: '2026/05/abc.pdf',
  mime: 'application/pdf',
  bytes: 1024,
};

const VALID_PAYLOAD: StructuredPayload = {
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

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.close();
    },
  });
}

function fakeStorage(): Storage {
  return {
    put: vi.fn(),
    get: vi.fn(async () => emptyStream()),
    stat: vi.fn(),
    delete: vi.fn(),
    url: vi.fn(() => '/api/documents/x'),
  } as unknown as Storage;
}

function fakeExtractor(opts: {
  mime: string;
  output: ExtractedText | null;
}): TextExtractor & { calls: TextExtractorInput[] } {
  const calls: TextExtractorInput[] = [];
  return {
    calls,
    canHandle(mime: string) {
      return mime === opts.mime;
    },
    async extract(input) {
      calls.push(input);
      return opts.output;
    },
  };
}

function fakeLlm(output: StructuredPayload | null): LLMExtractor & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async structure(text: string) {
      calls.push(text);
      return output;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractDocument', () => {
  it('happy path: first matching extractor wins and feeds the LLM', async () => {
    const pdfText = 'Boarding pass: BA287 LHR -> SFO 2026-06-01';
    const pdf = fakeExtractor({
      mime: 'application/pdf',
      output: { text: pdfText, method: 'pdf-text', confidence: 1 },
    });
    const ocr = fakeExtractor({
      mime: 'application/pdf',
      output: { text: 'should not be reached', method: 'ocr-tesseract', confidence: 0.7 },
    });
    const llm = fakeLlm(VALID_PAYLOAD);

    const result = await extractDocument(PDF_INPUT, deps([pdf, ocr], llm));

    expect(result).toEqual({
      status: 'ok',
      parsed: VALID_PAYLOAD,
      sourceMethod: 'llm-local',
      confidence: VALID_PAYLOAD.confidence,
      textMethod: 'pdf-text',
      charsExtracted: pdfText.length,
    });
    // The OCR extractor must not have been called because the first one won.
    expect(pdf.calls).toHaveLength(1);
    expect(ocr.calls).toHaveLength(0);
    // The LLM saw the text from the first extractor, not the second.
    expect(llm.calls).toEqual([pdfText]);
  });

  it('falls through to the next extractor when the first returns null', async () => {
    const pdf = fakeExtractor({ mime: 'application/pdf', output: null });
    const ocrText = 'BOARDING PASS recovered via OCR fallback path';
    const ocr = fakeExtractor({
      mime: 'application/pdf',
      output: { text: ocrText, method: 'ocr-tesseract', confidence: 0.8 },
    });
    const llm = fakeLlm(VALID_PAYLOAD);

    const result = await extractDocument(PDF_INPUT, deps([pdf, ocr], llm));

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.textMethod).toBe('ocr-tesseract');
    expect(pdf.calls).toHaveLength(1);
    expect(ocr.calls).toHaveLength(1);
  });

  it('skips extractors whose canHandle does not match the input MIME', async () => {
    const pdf = fakeExtractor({ mime: 'application/pdf', output: null });
    const png = fakeExtractor({
      mime: 'image/png',
      output: { text: 'wrong mime', method: 'ocr-tesseract', confidence: 0.5 },
    });
    const llm = fakeLlm(VALID_PAYLOAD);

    const result = await extractDocument(PDF_INPUT, deps([pdf, png], llm));

    expect(png.calls).toHaveLength(0);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('all-extractors-failed');
    }
  });

  it('returns failed with all-extractors-failed when every extractor yields null', async () => {
    const pdf = fakeExtractor({ mime: 'application/pdf', output: null });
    const ocr = fakeExtractor({ mime: 'application/pdf', output: null });
    const llm = fakeLlm(VALID_PAYLOAD);

    const result = await extractDocument(PDF_INPUT, deps([pdf, ocr], llm));

    expect(result).toEqual({ status: 'failed', reason: 'all-extractors-failed' });
    // LLM must not be called when there is no text to structure.
    expect(llm.calls).toHaveLength(0);
  });

  it('returns failed with llm-unavailable when the LLM returns null', async () => {
    const pdf = fakeExtractor({
      mime: 'application/pdf',
      output: { text: 'some text long enough to be useful', method: 'pdf-text', confidence: 1 },
    });
    const llm = fakeLlm(null);

    const result = await extractDocument(PDF_INPUT, deps([pdf], llm));

    expect(result).toEqual({ status: 'failed', reason: 'llm-unavailable' });
  });

  it('passes the extracted text to the LLM (no hint plumbing — the LLM discriminates from content)', async () => {
    // The orchestrator used to pass a filename-derived hint down to
    // the LLM. That layer is gone: classification now happens inside
    // the LLM prompt against a discriminated-union schema. This test
    // pins the new contract — `structure` receives only the text.
    const expectedText = 'hello world this is some longer text';
    const pdf = fakeExtractor({
      mime: 'application/pdf',
      output: { text: expectedText, method: 'pdf-text', confidence: 1 },
    });

    const captured: string[] = [];
    const llm: LLMExtractor = {
      async structure(text) {
        captured.push(text);
        return null;
      },
    };

    await extractDocument(PDF_INPUT, deps([pdf], llm));

    expect(captured).toEqual([expectedText]);
  });

  it('returns failed without throwing when Storage.get throws', async () => {
    const storage: Storage = {
      ...fakeStorage(),
      get: vi.fn(async () => {
        throw new Error('storage offline');
      }),
    } as unknown as Storage;

    const pdf = fakeExtractor({
      mime: 'application/pdf',
      output: { text: 'irrelevant', method: 'pdf-text', confidence: 1 },
    });
    const llm = fakeLlm(VALID_PAYLOAD);

    const result = await extractDocument(PDF_INPUT, {
      storage,
      extractors: [pdf],
      llm,
    });

    expect(result.status).toBe('failed');
    expect(pdf.calls).toHaveLength(0);
  });
});

function deps(extractors: TextExtractor[], llm: LLMExtractor): ExtractDocumentDeps {
  return { storage: fakeStorage(), extractors, llm };
}

function fakeDirectExtractor(opts: {
  mime: string;
  output: StructuredPayload | null;
}): DirectExtractor & { calls: DirectExtractorInput[] } {
  const calls: DirectExtractorInput[] = [];
  return {
    calls,
    canHandle(mime: string) {
      return mime === opts.mime;
    },
    async extract(input) {
      calls.push(input);
      return opts.output;
    },
  };
}

describe('extractDocument — direct extractors', () => {
  const PKPASS_INPUT: ExtractDocumentInput = {
    objectKey: '2026/05/boarding.pkpass',
    mime: 'application/vnd.apple.pkpass',
    bytes: 442,
  };

  it('short-circuits the text→LLM ladder when a direct extractor wins', async () => {
    const direct = fakeDirectExtractor({
      mime: 'application/vnd.apple.pkpass',
      output: VALID_PAYLOAD,
    });
    const textExtractor = fakeExtractor({
      mime: 'application/vnd.apple.pkpass',
      output: { text: 'should never be reached', method: 'pdf-text', confidence: 1 },
    });
    const llm = fakeLlm(null);

    const result = await extractDocument(PKPASS_INPUT, {
      storage: fakeStorage(),
      extractors: [textExtractor],
      directExtractors: [direct],
      llm,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.sourceMethod).toBe('pkpass');
    expect(result.parsed).toEqual(VALID_PAYLOAD);
    expect(result.textMethod).toBeNull();
    expect(direct.calls).toHaveLength(1);
    expect(textExtractor.calls).toHaveLength(0);
    expect(llm.calls).toHaveLength(0);
  });

  it('falls through to the text→LLM ladder when no direct extractor matches', async () => {
    const direct = fakeDirectExtractor({
      mime: 'application/vnd.apple.pkpass',
      output: VALID_PAYLOAD,
    });
    // Input MIME is pdf, direct extractor only handles pkpass — must fall through.
    const pdfText = 'Boarding pass: BA287';
    const textExtractor = fakeExtractor({
      mime: 'application/pdf',
      output: { text: pdfText, method: 'pdf-text', confidence: 1 },
    });
    const llm = fakeLlm(VALID_PAYLOAD);

    const result = await extractDocument(PDF_INPUT, {
      storage: fakeStorage(),
      extractors: [textExtractor],
      directExtractors: [direct],
      llm,
    });

    expect(direct.calls).toHaveLength(0);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.sourceMethod).toBe('llm-local');
    expect(result.textMethod).toBe('pdf-text');
  });

  it('falls through when a direct extractor matches MIME but returns null', async () => {
    // E.g. a pkpass that has no boardingPass block — extractor returns null;
    // there's no text extractor for pkpass mime, so the orchestrator fails
    // with all-extractors-failed.
    const direct = fakeDirectExtractor({
      mime: 'application/vnd.apple.pkpass',
      output: null,
    });
    const llm = fakeLlm(VALID_PAYLOAD);

    const result = await extractDocument(PKPASS_INPUT, {
      storage: fakeStorage(),
      extractors: [],
      directExtractors: [direct],
      llm,
    });

    expect(direct.calls).toHaveLength(1);
    expect(result.status).toBe('failed');
    expect(llm.calls).toHaveLength(0);
  });
});
