// Direct extractors produce a {@link StructuredPayload} straight from
// the file bytes, bypassing both the OCR text layer and the LLM. They
// are the cheapest, highest-confidence path on the ladder.
//
// Today this is just the pkpass extractor — Apple Wallet passes are
// ZIPs with a structured `pass.json`, so we don't need to OCR an image
// or ask an LLM to guess the carrier. Future siblings: ICS calendar
// invites, EML email attachments with itinerary blocks, etc.
//
// Implementations follow the same boundary rules as TextExtractor:
// `canHandle(mime)` is a cheap precheck, `extract` never throws, and
// any failure (parse error, missing fields, malformed input) returns
// `null` so the orchestrator falls through to the text→LLM ladder.

import type { StructuredPayload } from './types';

export interface DirectExtractorInput {
  /** Document bytes. Implementations drain safely. */
  stream: ReadableStream<Uint8Array>;
  mime: string;
  bytes: number;
}

export interface DirectExtractor {
  canHandle(mime: string): boolean;
  /**
   * Produce a structured payload directly from the file bytes. Returns
   * `null` if the format is recognised but the content can't be
   * usefully structured (e.g. a pkpass that has no boardingPass block).
   * Must NEVER throw.
   */
  extract(input: DirectExtractorInput): Promise<StructuredPayload | null>;
}
