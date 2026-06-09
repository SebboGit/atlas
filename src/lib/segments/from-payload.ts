// Mapper: extraction payload → segment create inputs.
//
// ADR-0008 commits us to creating segments from a successful
// extraction. This module is the one place that knows how to
// translate a StructuredPayload into the shape `segments.create`
// accepts. Pure (no I/O), so it's trivially testable.
//
// Multi-flight documents (return trips, multi-leg bookings) emit one
// segment per leg — the array shape carries that through unchanged.
//
// Three non-obvious rules enforced here:
//
// 1. `passengerName` is NEVER lifted onto the segment. The flight
//    segment represents the flight, not a particular traveller, and
//    the segment is what shows up on shared trip views. Names stay
//    on the source Document where they're contextually appropriate.
//    Structural enforcement: `FlightData` (validators.ts) has no
//    `passengerName` field, so even an accidental future addition
//    here would fail .strict() parsing.
//
// 2. `generic` payloads produce NO segments. The pipeline doesn't
//    invent travel events out of "I don't know what this is" outputs.
//
// 3. A boarding-pass leg with no anchor (no carrier+flightNumber, no
//    flightDate, no scheduledDeparture) is silently dropped — the
//    resulting segment would be a useless stub. The other legs of the
//    same payload are kept.

import { getAirlineName } from '@/lib/airlines';
import { getAirportCountry } from '@/lib/airports';
import type { FlightLeg, StructuredPayload } from '@/lib/extraction';
import { dateFromLocalInZone } from '@/lib/format';

import type { SegmentCreateInput } from './validators';

/**
 * Translate a successful extraction payload into zero or more
 * `SegmentCreateInput`s that `segments.repo.create` accepts. A
 * single-flight boarding pass, a hotel confirmation, and a restaurant
 * reservation each produce one input; a multi-leg boarding pass
 * produces one per leg; `generic` payloads produce none.
 *
 * The caller is responsible for:
 *   - boarding-pass dedup against existing segments on the trip,
 *   - computing `needsReview` from the trip window,
 *   - persisting the link onto the source document.
 *
 * Hotel / restaurant date-only fields land on **local midnight** via
 * `parseLocalDate`. Times — and flight dates — are floating local:
 * `parseFloatingDateTime` keeps the printed wall clock and interprets it
 * at UTC (ADR-0014 for non-flight times, ADR-0016 for flights), so a
 * segment shows the time printed on the document and buckets on the
 * printed calendar day, regardless of server or viewer timezone.
 */
export function payloadToSegmentInputs(payload: StructuredPayload): SegmentCreateInput[] {
  switch (payload.kind) {
    case 'boarding-pass': {
      const out: SegmentCreateInput[] = [];
      for (const leg of payload.flights) {
        const input = legToFlightSegment(leg);
        if (input) out.push(input);
      }
      return out;
    }
    case 'hotel-confirmation': {
      // Hotel needs at minimum a property name to satisfy the strict
      // validator. Without it we can't construct a meaningful segment;
      // the user can still create one manually from the parsed
      // payload visible on the Documents tab.
      if (!payload.hotelName) return [];

      const startsAt = parseLocalDate(payload.checkIn);
      const endsAt = parseLocalDate(payload.checkOut);
      return [
        {
          type: 'hotel',
          startsAt,
          endsAt,
          // Left null on extraction. The address goes in `data.address`
          // (full text) and the property name in `data.propertyName`;
          // `locationName` is a short pin-style label like "Bukit
          // Bintang" or "Kuala Lumpur" that the user fills in. Auto-
          // populating it from address duplicated the address on the
          // card subtitle (truncated to the field's maxLength), which
          // read badly; auto-populating from hotel name duplicated the
          // title. Better to leave blank than to guess wrong.
          locationName: null,
          countryCode: payload.country ?? null,
          data: {
            propertyName: payload.hotelName,
            ...(payload.address ? { address: payload.address } : {}),
            ...(payload.confirmationCode ? { confirmationNumber: payload.confirmationCode } : {}),
          },
        },
      ];
    }
    case 'restaurant-confirmation': {
      // A restaurant booking needs at minimum a venue name to satisfy
      // the strict food validator. Without it we can't construct a
      // meaningful segment; the user can still create one manually
      // from the parsed payload on the Documents tab.
      if (!payload.venueName) return [];

      // The reservation can be a full date+time or a bare date. A
      // bare date goes through parseLocalDate (local midnight) so it
      // buckets onto the same itinerary day the document prints. A full
      // datetime is floating local (ADR-0014): we store the printed
      // wall clock interpreted at UTC so it renders back verbatim for
      // every viewer, server-timezone-independent. `new Date()` would
      // instead anchor a naive time in the server's zone — correct only
      // by accident while that zone happens to be UTC.
      const startsAt =
        parseLocalDate(payload.reservationDateTime) ??
        parseFloatingDateTime(payload.reservationDateTime);
      return [
        {
          type: 'food',
          startsAt,
          endsAt: null,
          // Left null on extraction, mirroring the hotel mapper. The
          // extracted address goes in `data.address` (full text) and
          // the venue name in `data.venue`; `locationName` is a short
          // pin-style label the user fills in. Auto-filling it from
          // the address or venue name duplicated content on the card.
          // Better blank than wrong.
          locationName: null,
          countryCode: payload.country ?? null,
          data: {
            venue: payload.venueName,
            ...(payload.address ? { address: payload.address } : {}),
            ...(payload.confirmationCode ? { bookingRef: payload.confirmationCode } : {}),
          },
        },
      ];
    }
    case 'generic':
      return [];
  }
}

function legToFlightSegment(leg: FlightLeg): SegmentCreateInput | null {
  // Conservative posture matching the dedup rule (ADR-0008): if we
  // don't have at least one strong identifier — either the
  // carrier+flight-number pair or a date — there's no useful flight
  // to put on the itinerary. Refuse to create a stub with no anchor;
  // the user can still see the parsed payload on the Documents tab
  // and create a flight manually.
  const hasFlightId =
    (leg.carrier !== null && leg.flightNumber !== null) ||
    leg.flightDate !== null ||
    leg.scheduledDeparture !== null;
  if (!hasFlightId) return null;

  // Prefer the full ISO datetime when the extractor surfaced one
  // (pkpass `relevantDate`, LLM-parsed time on the document); fall back
  // to the date alone. Flight times are floating local (ADR-0016): we
  // store the wall clock the boarding pass prints, interpreted at UTC,
  // so the day buckets and the digits display verbatim — the origin /
  // destination airport supplies only the zone LABEL at render time, not
  // a clock conversion. A bare flightDate lands on UTC midnight (the
  // "no time component" sentinel). Same precedence for endsAt: only set
  // it if we actually have an arrival time.
  const startsAt =
    parseFloatingDateTime(leg.scheduledDeparture) ?? parseFloatingDateTime(leg.flightDate);
  const endsAt = parseFloatingDateTime(leg.scheduledArrival);

  // Resolve IATA → airline name so the stored segment carries a
  // human-readable carrier ("Vietnam Airlines") not the bare code
  // ("VN"). On a miss, keep whatever the extractor produced; the
  // display layer also runs the same lookup, so unresolved codes
  // still render readably.
  const resolvedCarrier = leg.carrier ? (getAirlineName(leg.carrier) ?? leg.carrier) : null;

  return {
    type: 'flight',
    startsAt,
    endsAt,
    // Destination dominates the per-segment locationName / country
    // for flights (see ADR-0005); origin gets `originCountryCode`.
    // Both countries are resolved from the IATA airport snapshot —
    // a flight with both IATAs known fills the chips on the trip
    // automatically; misses fall through to null and the user can
    // pick a country in the edit form.
    locationName: leg.destination ?? null,
    countryCode: getAirportCountry(leg.destination),
    originCountryCode: getAirportCountry(leg.origin),
    data: {
      ...(resolvedCarrier ? { carrier: resolvedCarrier } : {}),
      ...(leg.flightNumber ? { flightNumber: leg.flightNumber } : {}),
      ...(leg.origin ? { originAirport: leg.origin } : {}),
      ...(leg.destination ? { destinationAirport: leg.destination } : {}),
      ...(leg.confirmationCode ? { pnr: leg.confirmationCode } : {}),
    },
  };
}

// ISO YYYY-MM-DD → Date at local midnight. Matches the date-only
// branch in validators.ts so a user picking 2026-09-20 in the form
// and an extracted "flightDate: 2026-09-20" land on the same wall-
// clock day regardless of the server's timezone.
function parseLocalDate(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

// An ISO datetime that ends in an explicit UTC offset ("+02:00",
// "+0200") or "Z". The floating model ignores it (see below), so we
// only need to strip it off before parsing.
const HAS_OFFSET = /([+-]\d{2}:?\d{2}|Z)$/;
// Trailing seconds the schema permits but we render below minute
// precision — strip them so the minute-precision wall-clock parser
// (dateFromLocalInZone) accepts the value.
const TRAILING_SECONDS = /(T\d{2}:\d{2}):\d{2}$/;

// Datetime (or bare date) → Date, floating local (ADR-0014 for
// non-flight times, ADR-0016 for flights). We keep only the wall-clock
// parts the document printed and interpret them at UTC, so the time
// renders back verbatim for every viewer and the day buckets on the
// printed calendar day regardless of server or viewer timezone. Any
// printed offset is DROPPED on purpose: the floating model stores the
// clock the document shows, not an absolute instant — for flights the
// airport IATA supplies the zone label at render time. A bare date
// ("2026-09-20") lands on UTC midnight, the "no time" sentinel. Accepts
// every shape the scheduledDeparture / scheduledArrival / reservation
// schemas allow:
//   "2026-09-20"                        — bare date → UTC midnight
//   "2026-09-20T14:30" / ":00"          — naive wall clock
//   "2026-09-20T14:30:00+02:00" / "Z"   — offset stripped, clock kept
// Returns null on anything that doesn't parse cleanly.
function parseFloatingDateTime(s: string | null): Date | null {
  if (!s) return null;
  const naive = s.replace(HAS_OFFSET, '').replace(TRAILING_SECONDS, '$1');
  return dateFromLocalInZone(naive, 'UTC');
}
