// Document extraction orchestrator.
//
// Walks the cheap → expensive ladder defined in CLAUDE.md:
//
//   1. TextExtractor lineup (pdf-text → ocr-tesseract → future PaddleOCR)
//      — produces raw text from the file bytes
//   2. LLMExtractor (Ollama) — structures the text into a typed payload
//
// The orchestrator is pure: no DB writes, no filesystem assumptions
// beyond what Storage exposes. The server action layer is responsible
// for loading a Document row, calling extractDocument, and persisting
// the result.
//
// All failure modes return a tagged `failed` result with an
// {@link ExtractionFailureReason}; none throw. That keeps the caller's
// error handling simple: branch on `status`, write the appropriate
// columns, move on.

import { log } from '@/lib/log';
import type { ExtractedText, TextExtractor } from '@/lib/ocr';
import type { Storage } from '@/lib/storage';

import type { DirectExtractor } from './direct';
import { PKPASS_MIME } from './pkpass';
import type { ExtractionFailureReason, LLMExtractor, StructuredPayload } from './types';

/**
 * Text-extractor method values, derived from the source of truth in
 * `@/lib/ocr`. Keeps the orchestrator's `textMethod` union from
 * drifting if a new text extractor adds a method tag.
 */
type TextMethod = ExtractedText['method'];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Method that produced the structured payload. Mirrors the
 * `extraction_method` Postgres enum used by `documents.parsed_by` so
 * the caller can write the value back without a remap.
 */
export type ExtractionMethod = 'pdf-text' | 'ocr-tesseract' | 'llm-local' | 'pkpass';

export interface ExtractDocumentInput {
  /** Storage key resolved by the caller from the `documents` row. */
  objectKey: string;
  /** MIME confirmed by storage's magic-byte check. */
  mime: string;
  /** Declared byte length. Used for log lines only. */
  bytes: number;
}

export interface ExtractDocumentDeps {
  storage: Storage;
  llm: LLMExtractor;
  /** Priority-ordered list. The orchestrator stops at the first match. */
  extractors: readonly TextExtractor[];
  /**
   * Optional direct extractors that produce a StructuredPayload straight
   * from the file bytes (e.g. pkpass). The orchestrator tries these
   * BEFORE the text→LLM ladder — they're cheaper and the highest-
   * confidence path. Defaults to an empty list for back-compat.
   */
  directExtractors?: readonly DirectExtractor[];
}

export type ExtractDocumentResult =
  | {
      status: 'ok';
      parsed: StructuredPayload;
      /**
       * Which stage produced the payload. `pkpass` (or a future direct
       * extractor) means the LLM was never called; `llm-local` means
       * the text→LLM ladder.
       */
      sourceMethod: ExtractionMethod;
      /** Confidence of the producing stage, 0–1. */
      confidence: number;
      /**
       * Which text extractor fed the LLM, or `null` when a direct
       * extractor produced the payload and the LLM was bypassed.
       */
      textMethod: TextMethod | null;
      charsExtracted: number;
    }
  | {
      status: 'failed';
      reason: ExtractionFailureReason;
    };

/**
 * Run the extraction ladder for a single document. Pure: no DB writes.
 *
 * Failure semantics:
 *   - No text extractor handles the MIME or all produce `null`
 *     → `failed`, reason = `'all-extractors-failed'` (or the specific
 *     `'pdf-empty'` / `'ocr-empty'` when we can pinpoint the cause).
 *   - LLM returns `null` (transport, JSON, or schema failure)
 *     → `failed`, reason = `'llm-unavailable'` or `'llm-invalid-json'`.
 *     We can't tell these apart from the LLM layer's return value, so
 *     we default to `'llm-unavailable'`; the LLM layer's own logs
 *     distinguish them.
 */
export async function extractDocument(
  input: ExtractDocumentInput,
  deps: ExtractDocumentDeps,
): Promise<ExtractDocumentResult> {
  // -------------------------------------------------------------------------
  // 1. Direct extractors — cheapest, highest-confidence path. If a
  //    direct extractor produces a payload we short-circuit and never
  //    touch the LLM.
  // -------------------------------------------------------------------------
  const direct = await runDirectExtractors(input, deps);
  if (direct) {
    log.info(
      {
        objectKey: input.objectKey,
        mime: input.mime,
        sourceMethod: direct.sourceMethod,
        payloadKind: direct.payload.kind,
      },
      'extraction.orchestrator.direct_ok',
    );
    return {
      status: 'ok',
      parsed: direct.payload,
      sourceMethod: direct.sourceMethod,
      confidence: direct.payload.confidence,
      textMethod: null,
      charsExtracted: 0,
    };
  }

  // -------------------------------------------------------------------------
  // 2. Text extraction
  // -------------------------------------------------------------------------
  const text = await runTextExtractors(input, deps);
  if (!text) {
    return { status: 'failed', reason: 'all-extractors-failed' };
  }

  // -------------------------------------------------------------------------
  // 3. LLM structuring — the model classifies the document AND fills
  //    the matching schema in a single round-trip.
  // -------------------------------------------------------------------------
  const parsed = await deps.llm.structure(text.text);
  if (!parsed) {
    log.warn(
      {
        objectKey: input.objectKey,
        mime: input.mime,
        textMethod: text.method,
        charsExtracted: text.text.length,
      },
      'extraction.orchestrator.llm_failed',
    );
    return { status: 'failed', reason: 'llm-unavailable' };
  }

  log.info(
    {
      objectKey: input.objectKey,
      mime: input.mime,
      textMethod: text.method,
      payloadKind: parsed.kind,
      confidence: parsed.confidence,
    },
    'extraction.orchestrator.ok',
  );

  return {
    status: 'ok',
    parsed,
    sourceMethod: 'llm-local',
    confidence: parsed.confidence,
    textMethod: text.method,
    charsExtracted: text.text.length,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Try each direct extractor that matches the MIME. The first one that
 * returns a payload wins. Storage failures or empty extractor lineups
 * fall through quietly — the text→LLM ladder is still available.
 */
async function runDirectExtractors(
  input: ExtractDocumentInput,
  deps: ExtractDocumentDeps,
): Promise<{ payload: StructuredPayload; sourceMethod: ExtractionMethod } | null> {
  const lineup = deps.directExtractors ?? [];
  for (const extractor of lineup) {
    if (!extractor.canHandle(input.mime)) continue;

    let stream: ReadableStream<Uint8Array>;
    try {
      stream = await deps.storage.get(input.objectKey);
    } catch (err) {
      log.warn(
        {
          objectKey: input.objectKey,
          err: err instanceof Error ? err.name : 'unknown',
        },
        'extraction.orchestrator.storage_failed',
      );
      return null;
    }

    const payload = await extractor.extract({
      stream,
      mime: input.mime,
      bytes: input.bytes,
    });

    if (payload) {
      return { payload, sourceMethod: sourceMethodFor(input.mime) };
    }
  }
  return null;
}

/**
 * Map a MIME to the `extraction_method` enum value we record. Today
 * only pkpass is a direct extractor; future direct sources (ICS, EML
 * as a direct extractor, etc.) MUST add their own branch here AND a
 * matching value to the pgEnum in src/db/schema/documents.ts.
 *
 * Throws on an unknown MIME rather than silently stamping a wrong
 * value — corrupting the audit story (the previous behaviour, which
 * stamped `llm-local` even though the LLM was never called) was the
 * exact failure mode the code review caught. Failing loud surfaces
 * the "forgot a migration" mistake at the seam where it's still
 * cheap to fix.
 */
function sourceMethodFor(mime: string): ExtractionMethod {
  if (mime === PKPASS_MIME) return 'pkpass';
  throw new Error(
    `Direct extractor for MIME ${mime} has no ExtractionMethod mapping. ` +
      'Add a branch to sourceMethodFor() and a value to the extraction_method pgEnum.',
  );
}

/**
 * Iterate the extractor lineup, fetching a fresh stream from storage for
 * each attempt. We re-fetch rather than tee'ing the stream because the
 * legacy pdfjs build (and tesseract.js) both drain the input fully — a
 * tee buffer would have to hold the whole file in memory, which defeats
 * the streaming Storage contract.
 */
async function runTextExtractors(
  input: ExtractDocumentInput,
  deps: ExtractDocumentDeps,
): Promise<{ text: string; method: TextMethod } | null> {
  for (const extractor of deps.extractors) {
    if (!extractor.canHandle(input.mime)) continue;

    let stream: ReadableStream<Uint8Array>;
    try {
      stream = await deps.storage.get(input.objectKey);
    } catch (err) {
      log.warn(
        {
          objectKey: input.objectKey,
          err: err instanceof Error ? err.name : 'unknown',
        },
        'extraction.orchestrator.storage_failed',
      );
      return null;
    }

    const result = await extractor.extract({
      stream,
      mime: input.mime,
      bytes: input.bytes,
    });

    if (result) {
      return { text: result.text, method: result.method };
    }
    // Otherwise fall through to the next extractor.
  }

  return null;
}
