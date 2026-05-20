// Extraction interfaces, structured payload schemas, and tagged errors.
//
// Atlas's extraction pipeline turns raw text from a document
// (PDF text-layer, OCR output, or a pasted email body) into structured
// JSON. The last stage is an LLM call against a local Ollama instance —
// see docs/adr/0006-ollama-only-llm-extraction.md.
//
// The single capability behind an interface so the provider is a
// config swap, not a rewrite:
//
//   LLMExtractor — text → structured payload   (Ollama today)
//
// ADR-0009 retired the separate flight-metadata-lookup capability;
// scheduled times now come from the same LLM pass that classifies the
// document. Feature code imports from `@/lib/extraction` only; never
// from an implementation file.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Document kind discriminator
// ---------------------------------------------------------------------------

/**
 * The closed set of kinds the LLM is allowed to emit. Exported as a
 * const tuple so the prompt builder can derive its instructions from
 * the same source of truth — the literal strings in the prompt and
 * the Zod discriminator cannot drift apart silently.
 */
export const DOC_KINDS = ['boarding-pass', 'hotel-confirmation', 'generic'] as const;

/**
 * The discriminator value on a {@link StructuredPayload}. Once produced
 * by the LLM (or a direct extractor), this is the document's classified
 * kind — no longer a "hint", since the LLM picks it from the document
 * text itself rather than from a filename heuristic.
 */
export type DocKind = (typeof DOC_KINDS)[number];

// ---------------------------------------------------------------------------
// LLM extraction — structured payload (output)
// ---------------------------------------------------------------------------

// We keep the schema deliberately small: each variant covers what an LLM
// can plausibly pull out of a confirmation email or boarding pass with
// reasonable confidence.
//
// All times are ISO-8601 strings. The producer is responsible for
// including a timezone offset whenever the source document carries one.

// Local LLMs (notably 7B-class models) frequently emit `""` for "I
// don't know" rather than the requested `null`. Without this
// coercion, an otherwise-valid extraction with one empty optional
// field fails schema validation, retries once with the strict
// suffix, and then we drop the entire result. Treating whitespace-
// only strings as null at the schema boundary recovers the rest of
// the payload without changing the prompt contract.
const blankToNull = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), inner);

// Strip airline-industry annotations from a passenger name. Real
// boarding passes write strings like "DOE/JANE MRS (ADT)" where ADT
// is the passenger-type code (Adult; CHD = Child, INF = Infant) and
// MRS is the honorific. None of that is a name, and surfacing it as
// "Passenger: DOE/JANE MRS (ADT)" on the document card reads badly.
// Strip at the schema boundary so the cleaned form is what gets
// persisted (the source PDF stays authoritative for "what the
// document actually said"). Multiple passes so combined patterns
// like "DOE/JANE MRS (ADT)" peel cleanly.
//
// Honorifics intentionally span English + a handful of common
// European-language equivalents. Tickets routed through non-English
// booking flows (Lufthansa via Frankfurt, Vueling via Madrid, …)
// emit those forms verbatim. We do NOT include single-letter
// abbreviations like "M." (French Monsieur) because they collide
// with real initials in names ("DOE/J.M." or "JOHN M. DOE").
const PAX_TYPE_CODES = /\s*\(\s*(ADT|CHD|INF|YTH|SRC|MIL|STU|GRP)\s*\)\s*$/i;
const HONORIFIC =
  /[\s/](MR|MRS|MS|MISS|DR|MX|MSTR|SR|JR|PROF|FRAU|HERR|FRL|SRA|SRTA|MLLE|MME|SIG|SIGRA|SRTA|KHUN)\.?\s*$/i;
function cleanPassengerName(raw: string): string {
  let s = raw.trim();
  for (let i = 0; i < 3; i += 1) {
    const before = s;
    s = s.replace(PAX_TYPE_CODES, '');
    s = s.replace(HONORIFIC, '');
    s = s.trim();
    if (s === before) break;
  }
  return s;
}
// Exported for tests.
export const _cleanPassengerNameForTest = cleanPassengerName;

/**
 * Sanity cap on legs per document. Real-world itineraries don't
 * exceed ~6 legs (long-haul multi-city). Picked 8 to leave headroom
 * without inviting the model to hallucinate phantom legs.
 */
const MAX_FLIGHT_LEGS = 8;

/**
 * Per-flight fields shared by every leg of a boarding-pass document.
 * A single one-way doc returns one leg; a return trip returns two; a
 * multi-city itinerary returns N. `passengerName` and
 * `confirmationCode` are duplicated across legs (a real booking
 * shares both) — keeping them per-leg means the wrapper has no
 * shared-field plumbing and the mapper can produce one segment per
 * leg without cross-referencing fields elsewhere in the payload.
 */
const flightLegSchema = z.object({
  /** 2- or 3-letter carrier code (IATA preferred), upper-cased if possible. */
  carrier: blankToNull(z.string().min(2).max(8).nullable()),
  /** Flight number without the carrier prefix (e.g. "1234"). */
  flightNumber: blankToNull(z.string().min(1).max(8).nullable()),
  /** Scheduled local date of departure, ISO YYYY-MM-DD. */
  flightDate: blankToNull(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'flightDate must be YYYY-MM-DD')
      .nullable(),
  ),
  /**
   * Full scheduled departure date+time as printed on the document.
   * ISO 8601, with a timezone offset only when the document carries
   * one ("2026-09-20T14:30:00+02:00"); date+time without offset is
   * fine ("2026-09-20T14:30"). When only a date is known, leave this
   * null and rely on {@link flightDate}.
   */
  scheduledDeparture: blankToNull(
    z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)?$/,
        'scheduledDeparture must be ISO 8601 datetime',
      )
      .nullable(),
  ),
  /** Full scheduled arrival date+time. Same shape as scheduledDeparture. */
  scheduledArrival: blankToNull(
    z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)?$/,
        'scheduledArrival must be ISO 8601 datetime',
      )
      .nullable(),
  ),
  /** IATA code of the departure airport (3 letters, upper-case). */
  origin: blankToNull(
    z
      .string()
      .regex(/^[A-Z]{3}$/, 'origin must be a 3-letter IATA code')
      .nullable(),
  ),
  /** IATA code of the arrival airport (3 letters, upper-case). */
  destination: blankToNull(
    z
      .string()
      .regex(/^[A-Z]{3}$/, 'destination must be a 3-letter IATA code')
      .nullable(),
  ),
  /**
   * Passenger name as printed, with airline-industry noise stripped:
   * trailing passenger-type codes like `(ADT)` / `(CHD)` and trailing
   * honorifics like `MR`/`MRS` are removed at the schema boundary,
   * so consumers see "DOE/JANE" not "DOE/JANE MRS (ADT)". The
   * preprocess turns "" → null; the transform applies the cleanup
   * only to non-null strings.
   */
  passengerName: blankToNull(
    z
      .string()
      .min(1)
      .max(120)
      .nullable()
      .transform((v) => {
        if (v === null) return null;
        const cleaned = cleanPassengerName(v);
        return cleaned.length === 0 ? null : cleaned;
      }),
  ),
  /** Booking reference / PNR if present. Never logged — see log.ts redaction. */
  confirmationCode: blankToNull(z.string().min(1).max(20).nullable()),
});

const boardingPassPayloadSchema = z.object({
  kind: z.literal('boarding-pass'),
  /**
   * One entry per flight leg, in chronological order. A one-way doc
   * produces a single-element array; a return trip produces two; a
   * multi-city itinerary up to {@link MAX_FLIGHT_LEGS}. The min(1)
   * means an empty `flights: []` is rejected as malformed — the
   * extractor should classify such a doc as `generic` instead.
   */
  flights: z.array(flightLegSchema).min(1).max(MAX_FLIGHT_LEGS),
  /**
   * Extractor's confidence in this payload as a whole, 0–1. We don't
   * track per-leg confidence: in practice the model has the same
   * uncertainty about every leg of a single document (it either read
   * the page well or it didn't), and a per-leg field invited
   * meaningless variation.
   */
  confidence: z.number().min(0).max(1),
});

const hotelConfirmationPayloadSchema = z.object({
  kind: z.literal('hotel-confirmation'),
  /** Hotel / property name as it appears on the confirmation. */
  hotelName: blankToNull(z.string().min(1).max(200).nullable()),
  /** ISO YYYY-MM-DD check-in date. */
  checkIn: blankToNull(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'checkIn must be YYYY-MM-DD')
      .nullable(),
  ),
  /** ISO YYYY-MM-DD check-out date. */
  checkOut: blankToNull(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'checkOut must be YYYY-MM-DD')
      .nullable(),
  ),
  /** Free-form address string; geocoding is a downstream concern. */
  address: blankToNull(z.string().min(1).max(500).nullable()),
  /** Booking confirmation code. Never logged. */
  confirmationCode: blankToNull(z.string().min(1).max(40).nullable()),
  /** ISO 3166-1 alpha-2 country code if extractable. */
  country: blankToNull(
    z
      .string()
      .regex(/^[A-Z]{2}$/, 'country must be a 2-letter ISO code')
      .nullable(),
  ),
  confidence: z.number().min(0).max(1),
});

const genericPayloadSchema = z.object({
  kind: z.literal('generic'),
  /** A short human-readable summary of what the document is. */
  summary: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
});

/**
 * Zod schema for the LLM's response. Used by implementations to validate
 * `unknown` JSON before returning it as a typed payload.
 */
export const structuredPayloadSchema = z.discriminatedUnion('kind', [
  boardingPassPayloadSchema,
  hotelConfirmationPayloadSchema,
  genericPayloadSchema,
]);

export type StructuredPayload = z.infer<typeof structuredPayloadSchema>;
export type BoardingPassPayload = z.infer<typeof boardingPassPayloadSchema>;
export type FlightLeg = z.infer<typeof flightLegSchema>;
export type HotelConfirmationPayload = z.infer<typeof hotelConfirmationPayloadSchema>;
export type GenericPayload = z.infer<typeof genericPayloadSchema>;

// ---------------------------------------------------------------------------
// LLM extraction — interface
// ---------------------------------------------------------------------------

export interface LLMExtractor {
  /**
   * Structure free-form text into a {@link StructuredPayload}. The
   * implementation is responsible for asking the model to discriminate
   * between the three payload variants from the document text itself —
   * the caller does not pass a hint. Filename-based heuristics are
   * intentionally not part of this interface; they were brittle and
   * locale-bound.
   *
   * Implementations MUST:
   *   - Never throw on transport/network failure — return `null` instead.
   *   - Never throw on invalid LLM output — return `null` after a single
   *     retry with a stricter prompt suffix.
   *   - Never log the input text or the structured output (see log.ts
   *     redaction list).
   */
  structure(text: string): Promise<StructuredPayload | null>;
}

// ---------------------------------------------------------------------------
// Tagged failure reasons for the orchestrator (consumed in commit #4)
// ---------------------------------------------------------------------------

/**
 * Discriminator for the orchestrator's `Result` type. Each value
 * pinpoints which stage of the pipeline gave up so the caller can
 * decide whether to fall back, surface a message, or move on. Kept
 * here so the interfaces and their failure vocabulary travel together.
 */
export type ExtractionFailureReason =
  | 'pdf-empty'
  | 'ocr-empty'
  | 'llm-unavailable'
  | 'llm-invalid-json'
  | 'all-extractors-failed';
