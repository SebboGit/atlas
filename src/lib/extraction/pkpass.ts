// Apple Wallet (.pkpass) direct extractor.
//
// A .pkpass is a ZIP archive. We only care about `pass.json` — the
// structured pass payload — so we skip the manifest, signature, and
// image assets entirely. No signature verification: Atlas is a personal
// app, the user is the one who uploaded the file.
//
// Apple's pass.json schema lets each issuer pick their own field keys
// and labels, so we can't bind to a specific shape. We walk every
// field block (header / primary / secondary / auxiliary / back) and
// match field keys / labels against narrow keyword sets to map values
// onto our BoardingPassPayload shape.
//
// On success we return confidence: 1.0 — this is structured input, not
// a model guess. On failure (not a ZIP, no pass.json, malformed JSON,
// no recognisable boarding-pass fields) we return null and let the
// orchestrator fall through.

import { unzip } from 'unzipit';

import { log } from '@/lib/log';

import type { DirectExtractor, DirectExtractorInput } from './direct';
import { type FlightLeg, type StructuredPayload, structuredPayloadSchema } from './types';

export const PKPASS_MIME = 'application/vnd.apple.pkpass';

/**
 * Hard cap on the decompressed size of `pass.json`. A real pkpass's
 * pass.json is well under 50KB — flight info, field labels, asset
 * references, that's it. Anything claiming to inflate beyond this is
 * a zip-bomb, not a boarding pass; we refuse before allocating.
 *
 * Belt-and-braces guard: STORAGE_MAX_BYTES (20MB default) bounds the
 * source file, but a 20MB pkpass with a single deflated entry can
 * still expand to multiple GB.
 */
const MAX_PASS_JSON_BYTES = 2 * 1024 * 1024; // 2 MB

interface PkpassField {
  key?: unknown;
  label?: unknown;
  value?: unknown;
}

interface PkpassBoardingBlock {
  headerFields?: unknown;
  primaryFields?: unknown;
  secondaryFields?: unknown;
  auxiliaryFields?: unknown;
  backFields?: unknown;
}

interface PkpassRoot {
  organizationName?: unknown;
  description?: unknown;
  serialNumber?: unknown;
  relevantDate?: unknown;
  boardingPass?: unknown;
}

// Narrow keyword sets for mapping pkpass field keys / labels onto our
// schema. Substring match is intentional — issuers use both `flight`
// and `flightNumber`, both `from` and `origin`, etc.
const FLIGHT_NUMBER_KEYWORDS = ['flightnumber', 'flightno', 'flight'];
const ORIGIN_KEYWORDS = ['origin', 'from', 'departure', 'depart'];
const DESTINATION_KEYWORDS = ['destination', 'to', 'arrival', 'arrive'];
const PASSENGER_KEYWORDS = ['passenger', 'name', 'traveler', 'traveller'];
const DATE_KEYWORDS = ['date', 'flightdate'];
const CARRIER_KEYWORDS = ['carrier', 'airline', 'operator'];

export class PkpassExtractor implements DirectExtractor {
  canHandle(mime: string): boolean {
    return mime === PKPASS_MIME;
  }

  async extract(input: DirectExtractorInput): Promise<StructuredPayload | null> {
    const { mime, bytes } = input;

    try {
      const buf = await drainToUint8Array(input.stream);

      // drainToUint8Array returns a fresh Uint8Array — no need to wrap
      // it again. Pass the underlying ArrayBuffer directly.
      const { entries } = await unzip(buf.buffer);
      const passEntry = entries['pass.json'];
      if (!passEntry) {
        log.info({ mime, bytes, reason: 'no-pass-json' }, 'extraction.pkpass.skipped');
        return null;
      }

      // Refuse zip-bomb inputs before `.text()` allocates the decompressed
      // payload. `size` is the declared uncompressed size from the ZIP
      // central directory.
      if (passEntry.size > MAX_PASS_JSON_BYTES) {
        log.warn(
          { mime, bytes, declaredSize: passEntry.size, reason: 'pass-json-too-large' },
          'extraction.pkpass.failed',
        );
        return null;
      }

      const text = await passEntry.text();
      let root: PkpassRoot;
      try {
        root = JSON.parse(text) as PkpassRoot;
      } catch {
        log.warn({ mime, bytes, reason: 'pass-json-invalid' }, 'extraction.pkpass.failed');
        return null;
      }

      const boarding =
        root.boardingPass && typeof root.boardingPass === 'object'
          ? (root.boardingPass as PkpassBoardingBlock)
          : null;
      if (!boarding) {
        // Pkpass without a boardingPass block (e.g. coupon, event,
        // store card). Not our target — fall through.
        log.info({ mime, bytes, reason: 'not-boarding-pass' }, 'extraction.pkpass.skipped');
        return null;
      }

      const fields = collectFields(boarding);
      const leg = mapFieldsToFlightLeg(fields, root);

      // Require at least one of flight number / route to consider this
      // a useful extraction. A pass that's all "passenger name + date"
      // is too thin to auto-populate a flight segment.
      if (!leg.flightNumber && !leg.origin && !leg.destination) {
        log.info({ mime, bytes, reason: 'no-flight-fields' }, 'extraction.pkpass.skipped');
        return null;
      }

      // A .pkpass file holds a single pass — multi-leg trips are
      // delivered as separate .pkpass files (or a .pkpasses bundle,
      // not yet supported). So we always wrap a single leg here.
      const payload = {
        kind: 'boarding-pass' as const,
        flights: [leg],
        confidence: 1,
      };

      // Final Zod gate — same validation every LLM-produced payload
      // passes through. Catches edge cases where our regex-based
      // mapping produced a value the schema rejects (e.g. a 2-letter
      // string slipping through extractIata's `\b([A-Z]{3})\b` match).
      const validated = structuredPayloadSchema.safeParse(payload);
      if (!validated.success) {
        log.warn({ mime, bytes, reason: 'payload-schema-mismatch' }, 'extraction.pkpass.failed');
        return null;
      }

      log.info(
        {
          mime,
          bytes,
          method: 'pkpass',
          hasFlightNumber: leg.flightNumber !== null,
          hasRoute: leg.origin !== null && leg.destination !== null,
        },
        'extraction.pkpass.ok',
      );

      return validated.data;
    } catch (err) {
      log.warn(
        {
          mime,
          bytes,
          reason: 'unzip-failed',
          err: err instanceof Error ? err.name : 'unknown',
        },
        'extraction.pkpass.failed',
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

interface NormalisedField {
  key: string;
  label: string;
  value: string;
}

/**
 * Flatten every field block in a boardingPass into a normalised array
 * with lower-cased key + label and a stringified value. Anything that
 * doesn't look like a field (missing value, non-string-coercible) is
 * dropped.
 */
function collectFields(block: PkpassBoardingBlock): NormalisedField[] {
  const groups = [
    block.headerFields,
    block.primaryFields,
    block.secondaryFields,
    block.auxiliaryFields,
    block.backFields,
  ];
  const out: NormalisedField[] = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const raw of group as unknown[]) {
      if (!raw || typeof raw !== 'object') continue;
      const f = raw as PkpassField;
      const value = stringify(f.value);
      if (value === null) continue;
      const key = stringify(f.key)?.toLowerCase() ?? '';
      const label = stringify(f.label)?.toLowerCase() ?? '';
      out.push({ key, label, value });
    }
  }
  return out;
}

function stringify(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/**
 * Find the first field whose normalised key or label contains any of
 * the given keywords. Header fields are checked first (they're flat'
 * tier-1 callouts on the pass), then primary / secondary / auxiliary /
 * back in turn — but since we already flattened them in that order,
 * just walking the array preserves the priority.
 */
function findField(fields: NormalisedField[], keywords: string[]): string | null {
  for (const f of fields) {
    if (keywords.some((kw) => f.key.includes(kw) || f.label.includes(kw))) {
      return f.value;
    }
  }
  return null;
}

const IATA_AIRPORT_RE = /\b([A-Z]{3})\b/;
const IATA_CARRIER_NUMBER_RE = /^([A-Z]{2,3})\s*(\d{1,4}[A-Z]?)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function mapFieldsToFlightLeg(fields: NormalisedField[], root: PkpassRoot): FlightLeg {
  // Flight number can show up as "BA287" in one field or split across
  // carrier + number fields. Try both.
  const rawFlight = findField(fields, FLIGHT_NUMBER_KEYWORDS);
  let carrier: string | null = null;
  let flightNumber: string | null = null;
  if (rawFlight) {
    const match = rawFlight.toUpperCase().replace(/\s+/g, '').match(IATA_CARRIER_NUMBER_RE);
    if (match) {
      carrier = match[1] ?? null;
      flightNumber = match[2] ?? null;
    } else {
      // Either pure digits ("287") or non-standard format; keep the
      // raw value as the flight number and look for carrier separately.
      flightNumber = rawFlight;
    }
  }

  if (!carrier) {
    const rawCarrier = findField(fields, CARRIER_KEYWORDS) ?? stringify(root.organizationName);
    if (rawCarrier) {
      // organizationName is typically "British Airways"; we don't want
      // to store that in a 2-letter slot. Keep it short — only accept
      // 2- or 3-letter all-uppercase strings as IATA/ICAO codes.
      const trimmed = rawCarrier.trim();
      if (/^[A-Z]{2,3}$/.test(trimmed)) carrier = trimmed;
    }
  }

  // Origin / destination — strip to IATA code if the value embeds it
  // (e.g. "London (LHR)" or "LHR · London Heathrow").
  const origin = extractIata(findField(fields, ORIGIN_KEYWORDS));
  const destination = extractIata(findField(fields, DESTINATION_KEYWORDS));

  // Date sources: a date-typed pkpass field (issuer-specific, often
  // displayed as "Date: 2026-06-01") vs. root-level `relevantDate`
  // (per Apple's spec, ISO 8601 with timezone offset). They serve
  // different purposes here:
  //   - flightDate (date-only): the field's wall-clock label wins, so
  //     what we store matches what the user sees on the pass.
  //   - scheduledDeparture (datetime): `relevantDate` has minute-level
  //     precision and a timezone — the segment can land on the wall
  //     clock, not just the day. The field is a fallback only if it
  //     happens to be a datetime.
  // scheduledArrival isn't on a typical boarding pass — leave it null.
  const dateField = findField(fields, DATE_KEYWORDS);
  const relevantDate = stringify(root.relevantDate);
  const flightDate =
    (dateField ? normaliseDate(dateField) : null) ??
    (relevantDate ? normaliseDate(relevantDate) : null);
  const scheduledDeparture =
    (relevantDate ? normaliseDatetime(relevantDate) : null) ??
    (dateField ? normaliseDatetime(dateField) : null);

  const passengerName = findField(fields, PASSENGER_KEYWORDS);
  const confirmationCode = stringify(root.serialNumber);

  return {
    carrier,
    flightNumber,
    flightDate,
    scheduledDeparture,
    scheduledArrival: null,
    origin,
    destination,
    passengerName,
    confirmationCode,
  };
}

function extractIata(value: string | null): string | null {
  if (!value) return null;
  const match = value.toUpperCase().match(IATA_AIRPORT_RE);
  return match ? (match[1] ?? null) : null;
}

// Pull a YYYY-MM-DD wall-clock day from a pkpass date field. Two
// shapes are common: a bare "YYYY-MM-DD" the issuer dropped into a
// display field, or a full ISO 8601 datetime with an explicit timezone
// offset (per Apple's spec for `relevantDate`).
//
// The wall-clock day is what we want, NOT the UTC day: a Honolulu
// departure printed as "2026-06-01T01:30:00-10:00" is a June 1 flight
// from the passenger's perspective, even though it lands on May 31 in
// UTC. Slicing the raw string before the 'T' preserves whatever
// calendar day the issuer encoded, which matches the rest of the
// document's wall-clock framing.
const ISO_DATETIME_WITH_OFFSET_RE =
  /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:?\d{2}|Z)?$/;

function normaliseDate(value: string): string | null {
  const m = ISO_DATETIME_WITH_OFFSET_RE.exec(value);
  if (m) return m[1] ?? null;
  if (ISO_DATE_RE.test(value)) return value.slice(0, 10);
  // Try Date parsing as a last resort; some issuers stick localised
  // strings into field values. This branch loses the wall-clock-day
  // semantics — there's no offset to recover from a "1 June 2026"
  // string — but it's a best-effort path for non-ISO inputs.
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

// Match the BoardingPassPayload schema for scheduledDeparture /
// scheduledArrival — date+time with optional seconds and optional
// timezone offset.
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)?$/;

function normaliseDatetime(value: string): string | null {
  if (ISO_DATETIME_RE.test(value)) return value;
  // pkpass `relevantDate` may carry fractional seconds — strip them
  // before the round-trip so the schema regex still accepts the value.
  const withoutFraction = value.replace(/(:\d{2})\.\d+/, '$1');
  if (ISO_DATETIME_RE.test(withoutFraction)) return withoutFraction;
  return null;
}
