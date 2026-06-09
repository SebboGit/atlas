import { z } from 'zod';

import { isValidPlusCodeShape } from '@/lib/geocoding/plus-code';

// Mirrors the `segment_type` Postgres enum from src/db/schema/segments.ts.
// Kept inline so the Zod schema is self-contained and feature code
// doesn't have to reach into the db layer.
export const SEGMENT_TYPES = ['flight', 'hotel', 'activity', 'transit', 'food', 'note'] as const;
export const segmentTypeEnum = z.enum(SEGMENT_TYPES);
export type SegmentType = z.infer<typeof segmentTypeEnum>;

// ISO 3166-1 alpha-2. Stored uppercase; accept any case on input and
// normalise. Empty string is treated as "not set" so the dropdown's
// placeholder option ('') round-trips to NULL in the DB rather than
// failing the 2-char check. The actual existence check (FK to
// countries.code) happens in Postgres, not here — the seed
// populates the table.
const countryCode = z
  .union([z.string(), z.null()])
  .optional()
  .transform((s) => {
    if (s === null || s === undefined) return null;
    const t = s.trim();
    return t === '' ? null : t.toUpperCase();
  })
  .refine((s) => s === null || s.length === 2, 'Choose a valid country');

// Wall-clock string with no timezone, as the form hands it to us:
//   - 'yyyy-mm-dd'        → date-only pick from DatePicker
//   - 'yyyy-mm-ddThh:mm'  → date+time from DateTimeField
//
// Floating local time (ADR-0014): a non-flight segment stores the
// wall-clock the user typed VERBATIM, interpreted at UTC, so the stored
// instant's UTC wall-clock equals what they typed and renders back
// unchanged for every viewer ("20:00" → 20:00Z → shown as 20:00).
// Date-only lands on UTC midnight, which the cards read as "no time
// component". Returns null on malformed input.
const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;
export function wallClockToUtc(s: string): Date | null {
  const m = WALL_CLOCK_RE.exec(s);
  if (!m) return null;
  const [, y, mo, d, hh, mi] = m;
  const year = Number(y);
  const month = Number(mo) - 1;
  const day = Number(d);
  const hour = hh ? Number(hh) : 0;
  const minute = mi ? Number(mi) : 0;
  const date = new Date(Date.UTC(year, month, day, hour, minute, 0));
  if (Number.isNaN(date.getTime())) return null;
  // The regex checks digit count, not value range. `Date.UTC` silently
  // rolls over out-of-range fields (month 13, day 40, hour 25), so verify
  // the instant round-trips what was parsed — anything that shifted was
  // malformed. Keeps the null-on-malformed contract honest at the
  // schedule-action trust boundary.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return date;
}

// Date / date-time input. The form layer hands us a wall-clock string
// (date-only or date+time), an already-parsed Date (flights resolve
// their airport-tz instant before submit), or null / ''.
const dateInput = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    // No-timezone wall-clock → interpret at UTC (floating local time).
    const utc = wallClockToUtc(v);
    if (utc) return utc;
    // A wall-clock-shaped string that didn't parse is out-of-range — reject
    // it rather than let the `new Date` fallback below silently roll it over
    // (e.g. `new Date('2026-02-30')` → 2 Mar).
    if (WALL_CLOCK_RE.test(v)) return null;
    // Some other ISO string (explicit offset / Z) → respect it as given.
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  });

// Per-type structured data. Kept intentionally light — JSONB lets each
// shape grow without a schema migration. The repo layer writes the
// hot-path columns (startsAt/endsAt/locationName/countryCode) separately
// and is responsible for keeping `data` and the columns in sync.
const flightData = z
  .object({
    carrier: z.string().trim().max(100).optional(),
    flightNumber: z.string().trim().max(20).optional(),
    originAirport: z.string().trim().length(3).toUpperCase().optional(),
    destinationAirport: z.string().trim().length(3).toUpperCase().optional(),
    pnr: z.string().trim().max(20).optional(),
    seat: z.string().trim().max(10).optional(),
  })
  .strict();

// Optional Plus Code (Open Location Code) field. Accepts a full code
// ("8Q7XMPWG+5V") or a local code with anchor reference text
// ("MP7J+CV Minato City, Tokyo"); rejects a bare local code since it
// can't resolve without an anchor. Max length tolerates both shapes
// plus a typical city-and-country anchor.
//
// When present, `plusCode` takes precedence over `address` in
// `buildGeocodeQuery` — see [[plus-code-architecture]] memory.
const plusCode = z
  .string()
  .trim()
  .max(200)
  .optional()
  .refine((s) => (s === undefined ? true : isValidPlusCodeShape(s)), {
    message: 'Not a valid Plus Code',
  });

// Optional wall-clock time of day ("HH:MM", 24-hour) kept as display-only
// metadata in `data` — e.g. a hotel check-in / check-out time. Floating
// local time (ADR-0014): no date, no timezone, just the clock face the
// user typed. Deliberately NOT folded into `startsAt`/`endsAt` so it never
// influences day ordering — a hotel sorts by its check-in DATE alone (see
// `sortDaySegments` in group-by-day.ts). A blank field (the form submits
// '') normalises to undefined so an empty input doesn't trip the format
// check. The native `<input type="time">` already emits this exact shape.
const clockTime = z
  .string()
  .trim()
  .transform((s) => (s === '' ? undefined : s))
  .pipe(
    z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 15:00')
      .optional(),
  )
  .optional();

const hotelData = z
  .object({
    propertyName: z.string().trim().min(1).max(200),
    address: z.string().trim().max(500).optional(),
    plusCode,
    confirmationNumber: z.string().trim().max(50).optional(),
    roomType: z.string().trim().max(100).optional(),
    // Display-only — shown on the check-in card / last-day continuation,
    // never used for ordering (see `clockTime`).
    checkInTime: clockTime,
    checkOutTime: clockTime,
  })
  .strict();

// Activity gets `address` alongside `plusCode` — symmetric with hotels
// and food. Either field upgrades the pin from "title + locationName"
// (a landmark query) to a precise location.
const activityData = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    address: z.string().trim().max(500).optional(),
    plusCode,
    bookingRef: z.string().trim().max(50).optional(),
  })
  .strict();

// Transit endpoints are often stations rather than addresses, but a
// precise pin via `plusCode` or a street `address` is still useful for
// the long tail (obscure ferry terminals, bus stops by street).
const transitData = z
  .object({
    mode: z.enum(['train', 'bus', 'ferry', 'car', 'other']),
    carrier: z.string().trim().max(100).optional(),
    fromName: z.string().trim().max(200).optional(),
    toName: z.string().trim().max(200).optional(),
    address: z.string().trim().max(500).optional(),
    plusCode,
    referenceNumber: z.string().trim().max(50).optional(),
  })
  .strict();

// Food — a restaurant booking or a meal slotted on the itinerary.
// Deliberately light: the venue name, an optional address, and an
// optional booking reference. The reservation time itself lives on
// the shared `startsAt` column, not in `data` — same convention as
// activities. The address mirrors `hotelData.address` (same length
// cap, same blank-to-undefined handling) so the geocoder has a
// reliable signal when a restaurant doesn't resolve by name alone.
// Party size and a cuisine tag are explicitly v2 (see the
// food-segment-type design note) and intentionally NOT added here.
const foodData = z
  .object({
    venue: z.string().trim().min(1).max(200),
    address: z.string().trim().max(500).optional(),
    plusCode,
    bookingRef: z.string().trim().max(50).optional(),
  })
  .strict();

const noteData = z
  .object({
    body: z.string().trim().min(1).max(10000),
  })
  .strict();

// Type-safe accessors for read-side rendering. The DB returns `data` as
// `unknown` JSONB; the UI parses through these to get a known shape.
export const flightDataSchema = flightData;
export const hotelDataSchema = hotelData;
export const activityDataSchema = activityData;
export const transitDataSchema = transitData;
export const foodDataSchema = foodData;
export const noteDataSchema = noteData;

export type FlightData = z.infer<typeof flightData>;
export type HotelData = z.infer<typeof hotelData>;
export type ActivityData = z.infer<typeof activityData>;
export type TransitData = z.infer<typeof transitData>;
export type FoodData = z.infer<typeof foodData>;
export type NoteData = z.infer<typeof noteData>;

// Field layers — each variant in the discriminated union picks the
// layer that matches its geography. Notes have no place; activities
// /hotels/transit have one country + a free-text location; flights
// add an origin country on top.
//
// Why this matters: the form preserves state across type switches
// (so a user who bounces flight → note → flight doesn't lose their
// data). Without per-variant trimming, a stale `countryCode` from
// the flight branch would survive into the note submission, get
// written to the indexed column, and pollute the country-filter chip
// row with a "country" for a thing that has none.
const commonFields = z.object({
  startsAt: dateInput,
  endsAt: dateInput,
});
const geoFields = commonFields.extend({
  locationName: z.string().trim().max(200).nullable().optional(),
  countryCode,
});
const flightGeoFields = geoFields.extend({
  originCountryCode: countryCode,
});

// Discriminated union for segment creation. `type` is the
// discriminator; `data` shape is enforced per type via .strict()
// schemas above. The geography layers above keep notes off the
// country grid and keep originCountryCode flight-only.
//
// Food's `startsAt` is optional, exactly like an activity's. The
// user rarely books restaurants ahead, so a food segment works as an
// in-trip shortlist of "maybe" places — dated reservations and
// undated candidates live together. Undated food is reachable on its
// own flat Food tab (a single list of all food, sorted dated-first),
// so there's no "creatable yet unreachable" gap to guard against.
export const segmentCreateInput = z.discriminatedUnion('type', [
  flightGeoFields.extend({ type: z.literal('flight'), data: flightData }),
  geoFields.extend({ type: z.literal('hotel'), data: hotelData }),
  geoFields.extend({ type: z.literal('activity'), data: activityData }),
  geoFields.extend({ type: z.literal('transit'), data: transitData }),
  geoFields.extend({ type: z.literal('food'), data: foodData }),
  commonFields.extend({ type: z.literal('note'), data: noteData }),
]);
export type SegmentCreateInput = z.infer<typeof segmentCreateInput>;

// Batch update for the multi-leg flight-edit dialog. The dialog opens
// when a flight segment shares a document (or PNR) with other flight
// segments on the same trip — those siblings render as tabs and a
// single Save persists every edited leg atomically. The action layer
// enforces (a) every id is a flight segment the user owns on this
// trip, and (b) the per-leg `input.type` is `flight`. Non-flight
// segments are never reachable from the dialog, so the cap mirrors
// the extraction-side {@link MAX_FLIGHT_LEGS} hard cap of 8 — change
// both together if that ever moves.
export const flightLegsUpdateInput = z.object({
  legs: z
    .array(
      z.object({
        id: z.string().uuid(),
        input: segmentCreateInput,
      }),
    )
    .min(1)
    .max(8),
});
export type FlightLegsUpdateInput = z.infer<typeof flightLegsUpdateInput>;

// List filters used by the repo and by the trip-detail tabs / country
// filter. `scheduled` is tri-state on purpose:
//   true       → only segments with a date  (chronological views)
//   false      → only segments without a date (undated; see ADR-0003)
//   undefined  → both (default)
export const segmentListFilters = z.object({
  type: segmentTypeEnum.optional(),
  // The countryCode transform internally accepts undefined / '' / null;
  // .optional() at the object level lets repo callers omit the key
  // entirely without a TS complaint.
  countryCode: countryCode.optional(),
  scheduled: z.boolean().optional(),
});
// Use z.input rather than z.infer (= output) so callers can pass
// undefined for filters they don't care about — the type system
// shouldn't force them to spell out `country: null` everywhere.
export type SegmentListFilters = z.input<typeof segmentListFilters>;
