// Public surface of the OCR module. Feature code imports from here
// only — never from `./pdf-text` or `./ocr-tesseract` directly. This
// keeps the extractor lineup swappable as we add a PaddleOCR sidecar
// or render-and-OCR path for image-only PDFs.

import { EmlExtractor } from './eml';
import { TesseractOcr } from './ocr-tesseract';
import { PdfTextExtractor } from './pdf-text';
import { type TextExtractor } from './types';

export { MIN_USEFUL_CHARS } from './types';
export type { ExtractedText, TextExtractor, TextExtractorInput } from './types';

export { PdfTextExtractor } from './pdf-text';
export { TesseractOcr } from './ocr-tesseract';
export { EmlExtractor, EML_MIME, stripHtml } from './eml';

/**
 * Default extractor lineup in priority order — cheapest first. The
 * orchestrator walks this array and stops at the first non-null result.
 *
 * The array is `readonly` so callers don't mutate the global ordering
 * by accident; build a fresh array if you need a custom lineup for a
 * test.
 */
export function getDefaultExtractors(): readonly TextExtractor[] {
  return [new PdfTextExtractor(), new TesseractOcr(), new EmlExtractor()];
}
