// PDF text-layer extractor. The first and cheapest step in the
// extraction pipeline — most hotel/flight confirmations are text PDFs
// where pdfjs can pull the full content out without any OCR at all.
//
// IMPORTANT: pdfjs-dist's default entrypoint is browser-only. The
// `legacy/build/pdf.mjs` build is the one that works under Node. Don't
// "fix" this import.
//
// All errors are caught at the boundary and converted to `null`. The
// orchestrator (commit #4) decides what to do next; this extractor's
// job is to either produce text or get out of the way.

import { log } from '@/lib/log';

import {
  type ExtractedText,
  MIN_USEFUL_CHARS,
  type TextExtractor,
  type TextExtractorInput,
} from './types';

// pdfjs in Node = legacy build. The package's main entry assumes a
// DOM; the `legacy/` subpath is the documented Node entrypoint.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Minimal structural typing for the bits of the pdfjs API we use. The
// upstream typings cover this, but pinning to a local shape keeps us
// independent of subtle d.ts churn between minor versions.
interface PdfTextItem {
  str?: unknown;
}
interface PdfTextContent {
  items: ReadonlyArray<PdfTextItem>;
}
interface PdfPage {
  getTextContent(): Promise<PdfTextContent>;
}
interface PdfDocument {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

export class PdfTextExtractor implements TextExtractor {
  canHandle(mime: string): boolean {
    return mime === 'application/pdf';
  }

  async extract(input: TextExtractorInput): Promise<ExtractedText | null> {
    const { mime, bytes } = input;

    try {
      const data = await drainToUint8Array(input.stream);

      // Silence pdfjs's chatty warn() output. We've made a deliberate
      // choice to swallow recoverable parse warnings — they correspond
      // to "we found a broken-ish PDF but kept going". When extraction
      // fails we log our own one-liner with no document content.
      const verbosityLevel = readVerbosityErrorsLevel();

      // pdfjs.getDocument({ data }) takes OWNERSHIP of the typed array.
      // Today `drainToUint8Array` returns a fresh buffer per call so
      // this is safe; if a future refactor ever shares one buffer
      // across two extractors, the second pdfjs call would silently
      // see an empty/transferred view. Defend with `.slice()` if that
      // sharing ever happens.
      const loadingTask = pdfjs.getDocument({
        data,
        disableFontFace: true,
        useSystemFonts: false,
        verbosity: verbosityLevel,
        // Worker is irrelevant in Node — pdfjs uses a fake worker
        // automatically.
      });

      const doc = (await loadingTask.promise) as unknown as PdfDocument;
      let combined: string;
      try {
        const pages: string[] = [];
        for (let i = 1; i <= doc.numPages; i += 1) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items
            .map((item) => (typeof item.str === 'string' ? item.str : ''))
            .filter((s) => s.length > 0)
            .join(' ');
          pages.push(pageText);
        }
        combined = pages.join('\n').trim();
      } finally {
        await doc.destroy().catch(() => undefined);
      }

      if (combined.length < MIN_USEFUL_CHARS) {
        log.info(
          { mime, bytes, reason: 'pdf-empty', charsExtracted: combined.length },
          'ocr.pdf_text.empty',
        );
        return null;
      }

      log.info(
        { mime, bytes, method: 'pdf-text', charsExtracted: combined.length },
        'ocr.pdf_text.ok',
      );

      return {
        text: combined,
        method: 'pdf-text',
        confidence: 1,
      };
    } catch (err) {
      // Don't propagate. The orchestrator decides whether to fall back.
      log.warn(
        { mime, bytes, reason: 'pdf-parse-error', err: errorMessage(err) },
        'ocr.pdf_text.failed',
      );
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function drainToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Read `VerbosityLevel.ERRORS` off the pdfjs module without assuming a
 * specific concrete export shape — older builds expose it as a named
 * export, newer ones as a member. We fall back to `0`, which pdfjs
 * historically treats as "errors only".
 */
function readVerbosityErrorsLevel(): number {
  const ns = pdfjs as unknown as { VerbosityLevel?: { ERRORS?: unknown } };
  const raw = ns.VerbosityLevel?.ERRORS;
  return typeof raw === 'number' ? raw : 0;
}

function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown';
  // Name alone ("Error", "InvalidPDFException") tells us almost nothing;
  // include the message so the log explains *why* parsing failed
  // (password-protected, corrupt structure, version mismatch, etc.).
  // pdfjs error messages are about parser state, not document content,
  // so they're safe to log.
  return err.message ? `${err.name}: ${err.message}` : err.name;
}
