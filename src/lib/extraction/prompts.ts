// Prompt builder for the LLM extractor.
//
// The model receives the document text and a discriminated-union
// schema covering all three payload kinds, and is asked to pick the
// kind from the text itself. This replaces an earlier filename-keyword
// heuristic that was both English-biased and unreliable on real-world
// inputs ("Elektronisches Ticket", "Carte d'embarquement"). The LLM
// already sees a much richer signal (the actual document content),
// so it does the classification.
//
// Keep the prompt short and explicit. The local 7B model behaves much
// better with a tight schema and a single instruction than with a wall
// of text — even when the schema has three alternatives.

import { log } from '@/lib/log';

import { DOC_KINDS, type DocKind } from './types';

/**
 * Hard cap on the input text we send to the model. Most boarding passes
 * and hotel confirmations are well under this; large emails with
 * footers/legal can blow past it. The cap is in characters — a rough
 * stand-in for tokens, and good enough since we never need to be
 * exact about the budget. If we truncate, we log a warning.
 */
export const MAX_INPUT_CHARS = 8_000;

// Compile-time guarantee that every DocKind has a schema fragment
// below — and that the literal strings in the JSON schema fragments
// (which are user-readable, free text) match the discriminator values
// the Zod schema in types.ts will accept. Add a new variant to
// DOC_KINDS and TypeScript breaks here until you add its schema.
const _kindCoverage: Record<DocKind, true> = {
  'boarding-pass': true,
  'hotel-confirmation': true,
  generic: true,
};
void _kindCoverage;
// Also belt-and-braces: prevent silent reordering of DOC_KINDS.
const _kindOrder = DOC_KINDS satisfies readonly DocKind[];
void _kindOrder;

// Each schema fragment is the literal JSON shape we expect the model to
// emit when it picks the matching `kind`. Kept identical to the Zod
// definitions in types.ts — drift here means the LLM produces JSON
// that fails schema validation in OllamaExtractor.
const BOARDING_PASS_SCHEMA = `{
  "kind": "boarding-pass",
  "flights": [
    {
      "carrier": string (2-letter IATA airline code, upper-case — e.g. "BA", "LH", "VN"; NEVER the 3-letter ICAO code like "BAW"/"DLH") | null,
      "flightNumber": string (just the number portion without the carrier prefix; usually digits, may end with a single letter — e.g. "287", "1234A", "5") | null,
      "flightDate": string (YYYY-MM-DD, local date of departure) | null,
      "scheduledDeparture": string (ISO 8601 date+time of departure as printed on the document; include the timezone offset ONLY if the document prints one, e.g. "2026-09-20T14:30:00+02:00"; otherwise omit the offset, e.g. "2026-09-20T14:30") | null,
      "scheduledArrival": string (ISO 8601 date+time of arrival at the destination; same rules as scheduledDeparture) | null,
      "origin": string (3-letter IATA airport code, upper-case) | null,
      "destination": string (3-letter IATA airport code, upper-case) | null,
      "passengerName": string (just the name — strip honorifics like MR/MRS/MS/DR and ticketing codes like "(ADT)", "(CHD)", "(INF)"; keep the LAST/FIRST form if that's how it appears) | null,
      "confirmationCode": string (booking reference / PNR) | null
    }
  ],
  "confidence": number between 0 and 1
}`;

const HOTEL_CONFIRMATION_SCHEMA = `{
  "kind": "hotel-confirmation",
  "hotelName": string | null,
  "checkIn": string (YYYY-MM-DD) | null,
  "checkOut": string (YYYY-MM-DD) | null,
  "address": string | null,
  "confirmationCode": string | null,
  "country": string (ISO 3166-1 alpha-2, upper-case) | null,
  "confidence": number between 0 and 1
}`;

const GENERIC_SCHEMA = `{
  "kind": "generic",
  "summary": string (one short sentence describing what the document is),
  "confidence": number between 0 and 1
}`;

/**
 * Build the LLM prompt for a piece of extracted document text. The
 * input is truncated to {@link MAX_INPUT_CHARS} characters with a
 * warning log on truncation. Document contents are not included in
 * the log payload.
 */
export function buildPrompt(text: string): string {
  const truncated = text.length > MAX_INPUT_CHARS;
  const body = truncated ? text.slice(0, MAX_INPUT_CHARS) : text;

  if (truncated) {
    log.warn(
      { originalChars: text.length, truncatedChars: MAX_INPUT_CHARS },
      'extraction.prompt.truncated',
    );
  }

  return [
    'You are classifying and extracting structured data from a travel document.',
    '',
    'Decide which ONE of these three shapes best describes the document, then return that shape filled in:',
    '',
    '1. Flight document (boarding pass, e-ticket, airline confirmation, itinerary with a flight):',
    BOARDING_PASS_SCHEMA,
    '',
    '2. Hotel booking confirmation (hotel, B&B, resort, vacation rental, Airbnb):',
    HOTEL_CONFIRMATION_SCHEMA,
    '',
    "3. Anything else (passport scan, generic ticket, miscellaneous travel document, or you can't tell):",
    GENERIC_SCHEMA,
    '',
    'Rules:',
    '- Return ONLY a single JSON object matching exactly ONE of the three shapes above.',
    '- Set `kind` to the literal string of the shape you picked: "boarding-pass", "hotel-confirmation", or "generic".',
    '- For boarding-pass: `flights` is an array. A one-way single-flight document still returns a single-element array. If the document describes a return trip, connecting flights, or a multi-city itinerary, return one entry per flight leg in `flights[]`, in chronological order (earliest departure first). Do not invent legs the document does not describe.',
    '- Use `null` for any field whose value is not present in the document. Do not guess.',
    '- If you are uncertain about the kind, prefer "generic" — under-classify rather than mis-classify.',
    '- Do not wrap the JSON in markdown fences. Do not add prose before or after.',
    '- `confidence` reflects how certain you are about the values you returned, not how well you understand the task.',
    '',
    'Document text:',
    '"""',
    body,
    '"""',
  ].join('\n');
}

/**
 * Strict-mode suffix appended on the SINGLE retry after a JSON parse
 * failure. Kept as a stable constant so tests can assert it lands in
 * the second request body.
 */
export const STRICT_RETRY_SUFFIX =
  '\n\nIMPORTANT: Your previous response was not valid JSON. Respond with valid JSON only, no prose, no markdown, no commentary. The response must start with `{` and end with `}`.';
