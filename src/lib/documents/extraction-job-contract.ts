// Extraction job *contract* — the job name and payload shape, with no
// runtime dependencies. Deliberately split out from `./extraction-job.ts`
// (the handler) so the enqueue side can reference the job without pulling
// in the handler's module graph.
//
// Why this matters: `./extraction-job.ts` imports `@/lib/ocr`, which
// constructs `PdfTextExtractor` and so loads `pdfjs-dist`. pdfjs is a
// worker-only concern — but if a server action imports the handler module
// just to read the job *name*, pdfjs gets dragged into the Next.js app
// process too. In the production standalone build that load goes through
// Next's `externalImport` path and throws `ReferenceError: DOMMatrix is
// not defined`, taking down any server action / RSC render in the graph
// (uploading a document, adding a segment). Importing the name + type from
// here keeps the app process free of pdfjs entirely; only the worker, via
// `./extraction-job.ts`, ever loads it.

export const EXTRACTION_JOB = 'extraction';

export interface ExtractionJobData {
  userId: string;
  tripId: string;
  documentId: string;
  /** ISO-8601 string. The claim token (`documents.extractionStartedAt`). */
  claim: string;
  /**
   * Segment IDs this document was linked to BEFORE `markExtractionStarted`
   * wiped the links. The bridge uses these to decide which dedup
   * matches are this document's own prior segments (update in place)
   * vs. another document's segments (link only, leave fields alone).
   * Empty on first extraction.
   */
  priorLinkedSegmentIds: string[];
}
