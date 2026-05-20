// Tesseract.js-backed image OCR. The fallback path when a PDF has no
// text layer (i.e. it's just a scanned image) or when the source
// document is already an image.
//
// THIS COMMIT — only image MIMEs are handled. PDFs that arrive here
// without a text layer need to be rendered to images first, which is a
// separate concern (canvas / pdfjs render → image buffer). That logic
// will land alongside the PaddleOCR sidecar option in a follow-up so
// the orchestrator can pick the best engine for scanned PDFs. For now,
// `canHandle('application/pdf')` deliberately returns `false`.

import { createWorker, type Worker } from 'tesseract.js';

import { log } from '@/lib/log';

import {
  type ExtractedText,
  MIN_USEFUL_CHARS,
  type TextExtractor,
  type TextExtractorInput,
} from './types';

const SUPPORTED_IMAGE_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export class TesseractOcr implements TextExtractor {
  canHandle(mime: string): boolean {
    return SUPPORTED_IMAGE_MIMES.has(mime);
  }

  async extract(input: TextExtractorInput): Promise<ExtractedText | null> {
    const { mime, bytes } = input;

    if (!this.canHandle(mime)) {
      log.info({ mime, bytes, reason: 'unsupported-mime' }, 'ocr.tesseract.skipped');
      return null;
    }

    let worker: Worker | null = null;
    try {
      const buf = await drainToBuffer(input.stream);

      worker = await createWorker('eng');
      const result = await worker.recognize(buf);
      const text = (result.data.text ?? '').trim();
      // tesseract.js reports `confidence` on a 0–100 scale. Normalise to
      // 0–1 so the field is comparable across extractors. Clamp to be
      // defensive against unexpected upstream values.
      const rawConfidence = typeof result.data.confidence === 'number' ? result.data.confidence : 0;
      const confidence = Math.max(0, Math.min(1, rawConfidence / 100));

      if (text.length < MIN_USEFUL_CHARS) {
        log.info(
          { mime, bytes, reason: 'ocr-empty', charsExtracted: text.length },
          'ocr.tesseract.empty',
        );
        return null;
      }

      log.info(
        { mime, bytes, method: 'ocr-tesseract', charsExtracted: text.length, confidence },
        'ocr.tesseract.ok',
      );

      return {
        text,
        method: 'ocr-tesseract',
        confidence,
      };
    } catch (err) {
      log.warn(
        { mime, bytes, reason: 'tesseract-error', err: errorMessage(err) },
        'ocr.tesseract.failed',
      );
      return null;
    } finally {
      if (worker) {
        // terminate() should never bring down the caller; swallow.
        await worker.terminate().catch(() => undefined);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function drainToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown';
}
