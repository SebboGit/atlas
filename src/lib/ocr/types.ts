// OCR / text-extraction interface and shared types.
//
// Atlas's extraction pipeline is layered: cheap → expensive.
//   1. PdfTextExtractor   — pulls the embedded text layer out of a PDF
//   2. TesseractOcr       — falls back to image OCR
//   3. (future) PaddleOCR — denser image OCR for low-quality scans
//
// Every implementation conforms to {@link TextExtractor}. The
// orchestrator (commit #4) iterates implementations in priority order
// and stops at the first one that returns a non-null result.
//
// Implementations MUST:
//   - Never throw across the boundary — return `null` on any failure.
//   - Never log document contents (the logger redacts `ocrText` /
//     `rawText`; never bypass it).
//   - Treat a result below {@link MIN_USEFUL_CHARS} as empty and
//     return `null`.

/**
 * Input shape for a single extraction. Mirrors what `Storage.get(key)`
 * produces so the orchestrator can pipe directly from storage without
 * a copy.
 */
export interface TextExtractorInput {
  /** Document bytes. Implementations are responsible for draining safely. */
  stream: ReadableStream<Uint8Array>;
  /** MIME type as confirmed by the storage layer's magic-byte check. */
  mime: string;
  /** Declared byte length. Used for log lines and (optionally) sanity caps. */
  bytes: number;
}

/**
 * A successful extraction. Failures are signalled by returning `null` —
 * we never throw across this boundary so the orchestrator's fallback
 * loop stays simple.
 */
export interface ExtractedText {
  /** Raw extracted text. NEVER log this — see log.ts redaction list. */
  text: string;
  /**
   * Which path produced this text. Stored on `Document.extractionMethod`
   * so we can audit and re-run the pipeline against a single source.
   */
  method: 'pdf-text' | 'ocr-tesseract' | 'email';
  /**
   * Confidence in the result, 0–1. PDF text-layer extraction is `1.0`
   * (the text is authoritative when present). OCR returns whatever the
   * engine reports, normalised from its 0–100 scale.
   */
  confidence: number;
}

export interface TextExtractor {
  /**
   * Cheap pre-check — should this extractor be tried for this MIME?
   * The orchestrator uses it to skip impossible pairs without paying
   * for `extract()`.
   */
  canHandle(mime: string): boolean;

  /**
   * Run the extraction. Returns `null` when:
   *   - any error occurs (parse failure, malformed input, I/O error)
   *   - the result is below {@link MIN_USEFUL_CHARS}
   * Must NEVER throw.
   */
  extract(input: TextExtractorInput): Promise<ExtractedText | null>;
}

/**
 * Minimum text length we consider "useful". A PDF whose page is just
 * a logo and an empty text layer routinely yields a handful of
 * whitespace characters; we don't want to claim success on that and
 * skip the OCR fallback. 32 chars is comfortably below the shortest
 * real boarding-pass header line we've seen and well above the
 * accidental whitespace floor.
 */
export const MIN_USEFUL_CHARS = 32;
