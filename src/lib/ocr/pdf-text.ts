// PDF text-layer extractor. The first and cheapest step in the
// extraction pipeline — most hotel/flight confirmations are text PDFs
// where pdfjs can pull the full content out without any OCR at all.
//
// pdfjs is loaded lazily (see the `Pdfjs` type alias below for why and
// how) — there is intentionally no top-level pdfjs import in this file.
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

// pdfjs is loaded LAZILY — a dynamic import inside `extract()`, never a
// top-level import. A static import evaluates pdfjs-dist the moment any
// module in the graph loads this file, dragging it into the Next.js app
// process. In the production standalone build that load goes through Next's
// `externalImport` path and throws `ReferenceError: DOMMatrix is not
// defined` (Node has no DOM globals), taking down any server action or RSC
// render in the graph — uploading a document, adding a segment. pdfjs is
// only ever needed when we actually parse a PDF (in the worker), so we
// defer the import to the call site. The `legacy/` subpath is still the
// documented Node entrypoint — don't "fix" it to the default entry.
//
// `typeof import(...)` below is type-only and erased at compile time; it
// does NOT trigger a runtime load.
type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

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

      // Lazy-load pdfjs at the call site (see the type-only `Pdfjs` alias
      // above for why). Inside the try, so a load failure degrades to a
      // null result like any other parse failure rather than crashing.
      const pdfjs: Pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

      // Silence pdfjs's chatty warn() output. We've made a deliberate
      // choice to swallow recoverable parse warnings — they correspond
      // to "we found a broken-ish PDF but kept going". When extraction
      // fails we log our own one-liner with no document content.
      const verbosityLevel = readVerbosityErrorsLevel(pdfjs);

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
function readVerbosityErrorsLevel(pdfjs: Pdfjs): number {
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
