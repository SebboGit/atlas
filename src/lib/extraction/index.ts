// Public surface of the extraction module. Feature code imports from
// here only — never from `./ollama` or any other implementation file.
// This keeps the provider choice swappable and the interface contract
// the single source of truth.

export type {
  BoardingPassPayload,
  DocKind,
  ExtractionFailureReason,
  FlightLeg,
  GenericPayload,
  HotelConfirmationPayload,
  LLMExtractor,
  StructuredPayload,
} from './types';

export { structuredPayloadSchema } from './types';

export { createOllamaExtractor, OllamaExtractor } from './ollama';
export type { OllamaExtractorOptions } from './ollama';

export { extractDocument } from './orchestrator';
export type {
  ExtractDocumentDeps,
  ExtractDocumentInput,
  ExtractDocumentResult,
  ExtractionMethod,
} from './orchestrator';

export type { DirectExtractor, DirectExtractorInput } from './direct';
export { PKPASS_MIME, PkpassExtractor } from './pkpass';

import type { DirectExtractor } from './direct';
import { PkpassExtractor } from './pkpass';

/**
 * Default lineup of direct extractors — those that produce a structured
 * payload straight from the file bytes, bypassing OCR + LLM. The
 * orchestrator runs these BEFORE the text→LLM ladder.
 */
export function getDefaultDirectExtractors(): readonly DirectExtractor[] {
  return [new PkpassExtractor()];
}
