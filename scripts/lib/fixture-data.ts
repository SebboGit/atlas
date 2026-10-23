// Shared synthetic demo dataset used by two callers:
//
//   - scripts/screenshot-fixture.ts — produces the documentation
//     screenshots in docs/screenshots/.
//   - scripts/seed-dev-fixture.ts — seeds a sibling worktree so
//     `pnpm dev:up:wt` lands the dev server with a working trip,
//     wishlist items, and the "Not pinned" chip already visible.
//
// Nothing in this file is real travel data. Every trip, segment,
// document, address, and name is invented. Re-running is safe: the
// fixture user's trips, documents, wishlist items, sessions, and
// manual country marks are wiped and rebuilt every time.
//
// New features should extend `HERO_SEGMENTS`, `WISHLIST_ITEMS`, or
// `pin: null` edge cases here so the dataset stays a useful smoke
// target for worktree testing. Keep it minimal — one sample per
// feature shape, not a stress test.

import { randomBytes, randomUUID } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import {
  countries,
  documentSegments,
  documents,
  geocodeCache,
  segments,
  sessions,
  trips,
  userVisitedCountries,
  users,
  wishlistItems,
} from '../../src/db/schema';
import { ISO_COUNTRIES } from '../../src/lib/countries/data';
import { normalizeQuery } from '../../src/lib/geocoding/normalize';
import { encodePlusCode } from '../../src/lib/geocoding/plus-code';
import {
  buildGeocodeQuery,
  buildTransitEndpointQueries,
} from '../../src/lib/geocoding/segment-query';
import { tryParseStationQuery } from '../../src/lib/geocoding/station-query';

export const FIXTURE_SUB = 'screenshot-fixture-user';
export const FIXTURE_EMAIL = 'screenshot@atlas.local';

// UTC date helper — keeps the itinerary's day boundaries stable
// regardless of the machine timezone the capture runs on.
const d = (y: number, m: number, day: number, h = 12, min = 0): Date =>
  new Date(Date.UTC(y, m - 1, day, h, min));

// Midnight UTC of the same day — a trip's date from a segment's time.
const dayOf = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

// `now`-relative UTC date helper. The screenshots use fixed dates (the
// hero trip), but the *active* trip below must straddle "today" on
// every seed run so the chronological-map behaviours — collapsed-past,
// auto-scroll-to-today, and per-day focus (issue #9) — are always
// demonstrable in a dev worktree. `offsetDays` is relative to the UTC
// start of the day the seed runs.
// One base captured at module load, not per call — so every relative
// row anchors to the SAME "today" even if a seed run happens to straddle
// UTC midnight.
const REL_DAY_BASE = new Date();
const relDay = (offsetDays: number, h = 12, min = 0): Date =>
  new Date(
    Date.UTC(
      REL_DAY_BASE.getUTCFullYear(),
      REL_DAY_BASE.getUTCMonth(),
      REL_DAY_BASE.getUTCDate() + offsetDays,
      h,
      min,
    ),
  );

// Countries painted on the world-map choropleth. A believable, well-
// travelled spread across every continent — all synthetic. JP is also
// trip-derived from the hero trip below; the two sources merge.
const VISITED_COUNTRIES = [
  'AT',
  'AU',
  'CA',
  'CH',
  'DE',
  'ES',
  'FR',
  'GB',
  'ID',
  'IS',
  'IT',
  'JP',
  'MA',
  'MX',
  'NZ',
  'PT',
  'TH',
  'US',
  'VN',
  'ZA',
];

// --- Hero trip: a Japan itinerary, Tokyo → Kyoto -----------------------
//
// Each entry is a segment plus, for non-flight segments, the coordinates
// the geocode cache should resolve its query to. Flights are placed from
// the committed IATA airport snapshot, so they need no pin coords here.
// Every geocodable segment needs a `pin` — or `pin: null` for a
// deliberately-ungeocoded edge case, which seeds a negative cache row.
// Seeding throws on a geocodable segment with neither, so a seeded
// worktree renders without live geocoder calls. Train, bus and ferry
// legs have two endpoints (ADR-0019): `pin` is the destination and
// `fromPin` the origin, under the same rule. (A pin without a `city`
// still gets one background city re-resolve once its row ages — see
// place-coords.)
type FixturePin = { lat: number; lng: number; city?: string; source?: string };

type HeroSegment = {
  type: 'flight' | 'hotel' | 'activity' | 'transit' | 'food' | 'note';
  data: Record<string, unknown>;
  // Omitted for an undated activity / food pick (ADR-0003) — it lands on
  // its flat tab with no date, ready to be scheduled via the reschedule
  // dialog.
  startsAt?: Date;
  endsAt?: Date;
  locationName?: string;
  countryCode?: string;
  originCountryCode?: string;
  // Set directly because the fixture inserts rows without going through
  // the create action that normally computes it from the trip's ±2 day
  // window (ADR-0008). Defaults to false in the insert mapping.
  needsReview?: boolean;
  /**
   * Lat/lng the geocode cache should return for this segment's query.
   * `null` seeds a negative row (the geocoder "found nothing").
   * `source` overrides the seeded row's provider — set it to 'photon'
   * or 'nominatim' on a station endpoint to model a name the tagged
   * station rungs missed and the free-text ladder guessed at.
   */
  pin?: FixturePin | null;
  /**
   * The origin's pin for a train / bus / ferry leg, where `pin` is the
   * destination's. Same `null` rule. Ignored for every other segment.
   */
  fromPin?: FixturePin | null;
};

const HERO_SEGMENTS: HeroSegment[] = [
  {
    type: 'flight',
    data: {
      carrier: 'JL',
      flightNumber: '42',
      originAirport: 'LHR',
      destinationAirport: 'HND',
      pnr: 'ATLAS7',
      seat: '31K',
    },
    startsAt: d(2025, 10, 4, 11, 5),
    endsAt: d(2025, 10, 5, 8, 55),
    countryCode: 'JP',
    originCountryCode: 'GB',
  },
  {
    // Demonstrates the Plus Code path — a real local code with anchor.
    // `buildGeocodeQuery` returns the plusCode, so the seeded cache
    // row lands at the Plus-Code key and the card shows the badge.
    type: 'hotel',
    data: {
      propertyName: 'Hotel Niwa Tokyo',
      address: '1-1-16 Misakicho, Chiyoda City, Tokyo 101-0061',
      plusCode: 'MQ8R+5C Chiyoda City, Tokyo',
      confirmationNumber: 'HN-20488',
      roomType: 'Garden twin',
      // Display-only times (the check-in shows on the card, the check-out
      // on the stay's last-day "Staying" row) — never affect ordering.
      checkInTime: '15:00',
      checkOutTime: '11:00',
    },
    startsAt: d(2025, 10, 5),
    endsAt: d(2025, 10, 7),
    locationName: 'Chiyoda',
    countryCode: 'JP',
    pin: { lat: 35.6968, lng: 139.7536, city: 'Chiyoda' },
  },
  {
    type: 'activity',
    data: { title: 'Sensō-ji' },
    startsAt: d(2025, 10, 5, 7),
    locationName: 'Asakusa',
    countryCode: 'JP',
    pin: { lat: 35.7148, lng: 139.7967, city: 'Taitō' },
  },
  {
    type: 'activity',
    data: { title: 'teamLab Planets', bookingRef: 'TLB-7782' },
    startsAt: d(2025, 10, 6, 10),
    locationName: 'Toyosu',
    countryCode: 'JP',
    pin: { lat: 35.6499, lng: 139.7906, city: 'Kōtō' },
  },
  // Ungeocoded edge case: an activity at a friend's place with no
  // public address. Its geocode query nulls in the cache (`pin: null`),
  // so it surfaces in the trip map's "Not pinned" chip without making a
  // live geocoder call.
  {
    type: 'activity',
    data: { title: "Friend's place — drinks" },
    startsAt: d(2025, 10, 6, 19),
    countryCode: 'JP',
    pin: null,
  },
  // Timed food reservation — exercises the Food tab's date+time card and
  // the reschedule affordance (a dated meal alongside the undated "Den"
  // pick materialised from the wishlist below).
  {
    type: 'food',
    data: {
      venue: 'Narisawa',
      address: '2-6-15 Minamiaoyama, Minato City, Tokyo',
      bookingRef: 'NRSW-1907',
    },
    startsAt: d(2025, 10, 5, 19, 30),
    locationName: 'Minami-Aoyama',
    countryCode: 'JP',
    pin: { lat: 35.6661, lng: 139.7184 },
  },
  // Undated activity — a candidate not yet pinned to a day (ADR-0003).
  // Exercises the flat Activities tab's undated card (no badge) and the
  // "Schedule" promotion path. Pinned, so it still appears on the map.
  {
    type: 'activity',
    data: { title: 'Golden Gai — late drinks' },
    locationName: 'Shinjuku',
    countryCode: 'JP',
    pin: { lat: 35.6938, lng: 139.7045 },
  },
  {
    type: 'transit',
    data: {
      mode: 'train',
      carrier: 'JR Tōkaidō Shinkansen',
      fromName: 'Tokyo Station',
      toName: 'Kyoto Station',
      referenceNumber: 'NZ-RAIL-31',
    },
    startsAt: d(2025, 10, 7, 9, 12),
    endsAt: d(2025, 10, 7, 11, 30),
    locationName: 'Tokyo → Kyoto',
    countryCode: 'JP',
    pin: { lat: 34.9858, lng: 135.7588 },
    fromPin: { lat: 35.6812, lng: 139.7671, city: 'Chiyoda' },
  },
  // Date-only stay (00:00Z both ends, like a form-entered hotel) checking in
  // on the train day — the same-day transit→hotel ordering case. Plain
  // chronological order would float it above the 09:12 Shinkansen; bound to
  // the train's arrival it reads train → hotel, under Hotel Niwa's check-out
  // "Staying" row.
  {
    type: 'hotel',
    data: {
      propertyName: 'Nazuna Kyoto Gosho',
      address: '185 Kamariyacho, Kamigyo Ward, Kyoto 602-0917',
      confirmationNumber: 'NZ-4471',
      roomType: 'Machiya suite',
      checkInTime: '15:00',
      checkOutTime: '10:00',
    },
    startsAt: d(2025, 10, 7, 0),
    endsAt: d(2025, 10, 10, 0),
    locationName: 'Kamigyō',
    countryCode: 'JP',
    pin: { lat: 35.0292, lng: 135.7592 },
  },
  // Second ungeocoded edge case: a hotel with no address on file. The
  // geocode query is the property name alone, and that's pre-cached as
  // null. With the bus below, the chip count reads three.
  {
    type: 'hotel',
    data: {
      propertyName: 'Guest house — TBC',
      confirmationNumber: 'TBC-0001',
    },
    startsAt: d(2025, 10, 9),
    endsAt: d(2025, 10, 10),
    countryCode: 'JP',
    pin: null,
  },
  {
    type: 'activity',
    data: { title: 'Fushimi Inari' },
    startsAt: d(2025, 10, 8, 7, 30),
    locationName: 'Fushimi',
    countryCode: 'JP',
    pin: { lat: 34.9671, lng: 135.7727 },
  },
  // Half-pinned route (ADR-0019): the origin station resolves, the
  // pickup point doesn't. The map draws the Kyoto Station pin with no
  // line, and the leg lands in the "Not pinned" chip once, as an arrival
  // point the geocoder couldn't find.
  {
    type: 'transit',
    data: {
      mode: 'bus',
      fromName: 'Kyoto Station',
      toName: 'Ryokan pickup — TBC',
    },
    startsAt: d(2025, 10, 8, 14),
    locationName: 'Kyoto',
    countryCode: 'JP',
    pin: null,
    fromPin: { lat: 34.9858, lng: 135.7588 },
  },
  {
    type: 'activity',
    data: { title: 'Arashiyama bamboo grove' },
    startsAt: d(2025, 10, 9, 9),
    locationName: 'Arashiyama',
    countryCode: 'JP',
    pin: { lat: 35.0174, lng: 135.6722 },
  },
  {
    type: 'note',
    data: { body: 'Buy matcha at Ippodo before heading to the airport.' },
    startsAt: d(2025, 10, 9, 16),
  },
  // Undated note — a general trip reminder with no day to file under.
  // Exercises the itinerary's "Undated" section: note and transit have no
  // dedicated tab, so an undated one of those types surfaces only there.
  {
    type: 'note',
    data: { body: 'Carry cash — many izakaya and small shops are still cash-only.' },
  },
  {
    type: 'flight',
    data: {
      carrier: 'JL',
      flightNumber: '43',
      originAirport: 'KIX',
      destinationAirport: 'LHR',
      pnr: 'ATLAS7',
      seat: '44A',
    },
    startsAt: d(2025, 10, 10, 11, 40),
    endsAt: d(2025, 10, 10, 16, 20),
    countryCode: 'GB',
    originCountryCode: 'JP',
  },
  // needs-review edge case (ADR-0008): an auto-created segment whose
  // parsed date landed outside the trip's ±2 day window. The trip ends
  // Oct 10, so Oct 13 is past the +2 day tolerance — it stays flagged
  // even after an edit re-save, not just on first insert. Exercises the
  // review strip and its hover edit/delete cluster on the segment card
  // (see segment-card-shell.tsx).
  {
    type: 'activity',
    data: { title: 'Nishiki Market food crawl', bookingRef: 'NMK-3320' },
    startsAt: d(2025, 10, 13, 10),
    locationName: 'Nakagyō',
    countryCode: 'JP',
    needsReview: true,
    pin: { lat: 35.005, lng: 135.7649 },
  },
];

// The Pudeto catamaran dock on Pehoé's eastern shore, the Patagonia
// ferry's origin. Its full Plus Code is encoded, not typed, so the code
// can't drift from the pin; it is also the origin's cache key.
const PUDETO_DOCK = { lat: -51.0614, lng: -72.9899 };
const PUDETO_PLUS_CODE = encodePlusCode(PUDETO_DOCK.lat, PUDETO_DOCK.lng, 11);
if (!PUDETO_PLUS_CODE) throw new Error('Fixture: failed to encode the Pudeto Plus Code.');

// --- Active trip: Patagonia, dated relative to "now" ------------------
//
// The hero trip is `completed`, so it can't exercise the chronological
// map's active-trip behaviours (issue #9): collapsed-past, auto-scroll-
// to-today, and per-day focus all fire ONLY for an `active` trip whose
// days span past + today + future. This set is dated with `relDay` so
// it always straddles whatever day the seed runs. It includes a multi-
// day hotel that started in the past and runs through today (the
// splitCollapsedDays "ongoing segment" rule), a multi-day activity (the
// non-hotel "Ongoing" continuation wording), and one ungeocoded item.
const PATAGONIA_SEGMENTS: HeroSegment[] = [
  {
    // Past arrival flight — folds into the collapsed-past pill.
    type: 'flight',
    data: {
      carrier: 'LA',
      flightNumber: '283',
      originAirport: 'SCL',
      destinationAirport: 'PUQ',
      pnr: 'PATGON',
      seat: '14C',
    },
    startsAt: relDay(-3, 8, 30),
    endsAt: relDay(-3, 12, 5),
    countryCode: 'CL',
    originCountryCode: 'CL',
  },
  {
    // Multi-day hotel: checked in two days ago, checks out in two days.
    // Ongoing as of today, so its check-in card collapses into the past
    // pill and the stay surfaces as a "Staying" continuation on today +
    // the future days it spans. The check-out time shows ONLY on the final
    // day — the ferry day, relDay(+2) in the UTC seed/screenshot env (a day
    // earlier on a west-of-UTC viewer, but always on the last rendered row)
    // — demonstrating the last-day check-out treatment on both the
    // itinerary and the chrono-map rail.
    type: 'hotel',
    data: {
      propertyName: 'Hotel Las Torres',
      address: 'Torres del Paine National Park, Magallanes, Chile',
      confirmationNumber: 'HLT-5521',
      roomType: 'Mountain-view double',
      checkInTime: '15:00',
      checkOutTime: '10:00',
    },
    startsAt: relDay(-2),
    endsAt: relDay(2),
    locationName: 'Torres del Paine',
    countryCode: 'CL',
    pin: { lat: -50.9423, lng: -72.9886 },
  },
  {
    // Yesterday — a past day after the hotel check-in, so it stays
    // visible (part of the live stretch), not collapsed.
    type: 'activity',
    data: { title: 'Base Torres day hike' },
    startsAt: relDay(-1, 7),
    locationName: 'Torres del Paine',
    countryCode: 'CL',
    pin: { lat: -50.9, lng: -72.9 },
  },
  {
    // Multi-day activity: a park trekking pass running yesterday →
    // tomorrow. Spans today, so the non-hotel continuation row — worded
    // "Ongoing", not "Staying" — shows on the default itinerary view and
    // the chrono-map rail, right beside the hotel's "Staying" row.
    type: 'activity',
    data: { title: 'W Trek — park pass', bookingRef: 'CONAF-8841' },
    startsAt: relDay(-1, 8),
    endsAt: relDay(1, 18),
    locationName: 'Torres del Paine',
    countryCode: 'CL',
    pin: { lat: -50.95, lng: -72.95 },
  },
  {
    // Today — the auto-scroll-to-today anchor.
    type: 'activity',
    data: { title: 'French Valley viewpoint' },
    startsAt: relDay(0, 8),
    locationName: 'Valle del Francés',
    countryCode: 'CL',
    pin: { lat: -51.0167, lng: -73.0833 },
  },
  {
    // Today, later — an ungeocoded item (no public address) so the
    // active trip also shows the "not on the map" rail treatment.
    type: 'activity',
    data: { title: "Ranger's cabin — gear swap" },
    startsAt: relDay(0, 18),
    countryCode: 'CL',
    pin: null,
  },
  {
    // Tomorrow — a dated note, so the active trip's upcoming days carry
    // one too (the hero's only dated note is in the past).
    type: 'note',
    data: { body: 'Pack the rain shell — wind picks up after 3pm on the W.' },
    startsAt: relDay(1, 7),
  },
  {
    type: 'food',
    data: { venue: 'Refugio Chileno', bookingRef: 'RCH-19' },
    startsAt: relDay(1, 13),
    locationName: 'Valle Ascencio',
    countryCode: 'CL',
    pin: { lat: -50.9581, lng: -72.9103 },
  },
  {
    // #144 edge case: a name-only origin the tagged station rungs miss.
    // Its seeded cache row carries a free-text source, so both pins
    // render but the map withholds the line and the leg joins the
    // Not-pinned list saying the departure looks wrong.
    type: 'transit',
    data: {
      mode: 'bus',
      carrier: 'Buses Gómez',
      fromName: 'Laguna Amarga',
      toName: 'Pudeto',
      referenceNumber: 'BUS-214',
    },
    startsAt: relDay(2, 8),
    endsAt: relDay(2, 9, 30),
    locationName: 'Torres del Paine',
    countryCode: 'CL',
    pin: PUDETO_DOCK,
    // Lima — what a country-free free-text lookup for a park shuttle
    // stop comes back with. 4,354 km from Pudeto: far enough clear of
    // the 1,800 km bus fallback threshold that a tune can't silently
    // stop this leg demonstrating #144, and still inside the 5,000 km
    // bus cap, so without the guard the line would still be drawn.
    fromPin: { lat: -12.0464, lng: -77.0428, city: 'Lima', source: 'photon' },
  },
  {
    // Future — a preview day, rendered but past the today anchor.
    type: 'transit',
    data: {
      mode: 'ferry',
      carrier: 'Hielos Patagónicos',
      fromName: 'Pudeto',
      // Exercises the pinned From state; Directions still links the name.
      fromPlusCode: PUDETO_PLUS_CODE,
      toName: 'Refugio Paine Grande',
      referenceNumber: 'FERRY-77',
    },
    startsAt: relDay(2, 10),
    endsAt: relDay(2, 10, 30),
    locationName: 'Lago Pehoé',
    countryCode: 'CL',
    pin: { lat: -51.06, lng: -73.07 },
    fromPin: PUDETO_DOCK,
  },
  // Onward leg — the same-day flight→hotel ordering case made visible.
  // An evening flight back to Santiago (lands 21:30) and a date-only
  // check-in that same day. The hotel's 00:00Z anchor would sort it ABOVE
  // the 18:00 flight under plain chronological order; bound to the flight's
  // landing it correctly follows it, so this future day reads
  // flight → hotel (you fly first, then check in).
  {
    type: 'flight',
    data: {
      carrier: 'LA',
      flightNumber: '292',
      originAirport: 'PUQ',
      destinationAirport: 'SCL',
      pnr: 'PATGON',
      seat: '9D',
    },
    startsAt: relDay(3, 18),
    endsAt: relDay(3, 21, 30),
    countryCode: 'CL',
    originCountryCode: 'CL',
  },
  {
    type: 'hotel',
    data: {
      propertyName: 'Hotel Cumbres Lastarria',
      address: 'José Victorino Lastarria 299, Santiago, Chile',
      confirmationNumber: 'HCL-7781',
      roomType: 'City queen',
      checkInTime: '23:00',
      checkOutTime: '06:00',
    },
    startsAt: relDay(3, 0),
    endsAt: relDay(4, 0),
    locationName: 'Santiago',
    countryCode: 'CL',
    pin: { lat: -33.4372, lng: -70.6394 },
  },
  // Last-day hop across the Andes — a second country on the active trip,
  // so its country chips and map span CL and AR.
  {
    type: 'flight',
    data: {
      carrier: 'LA',
      flightNumber: '465',
      originAirport: 'SCL',
      destinationAirport: 'EZE',
      pnr: 'PATGON',
      seat: '21K',
    },
    startsAt: relDay(4, 9),
    endsAt: relDay(4, 11, 5),
    countryCode: 'AR',
    originCountryCode: 'CL',
  },
  {
    type: 'food',
    data: { venue: 'Don Julio', bookingRef: 'DJ-3021' },
    startsAt: relDay(4, 20),
    locationName: 'Palermo',
    countryCode: 'AR',
    pin: { lat: -34.5864, lng: -58.4269 },
  },
];

// --- Side trips: Lisbon `now`-relative, the rest fixed-date ----------
//
// Lighter than the hero, but each a believable trip end to end, so the
// dashboard, stats and per-trip maps look lived-in rather than empty.
// Same `HeroSegment` shape and pin rules as above.

// Trip titles double as the lookup keys that wire each segment list to
// its inserted trip row.
const PATAGONIA_TITLE = 'Patagonia';
const LISBON_TITLE = 'Lisbon, Porto & Seville';
const DOLOMITES_TITLE = 'Dolomites';
// Deliberately long — see the trip insert.
const SCOTLAND_TITLE = 'A Long Way Round the North Coast of Scotland and the Outer Hebrides';
// Earlier, smaller trips — a flight out, a hotel, a flight home — so the
// stats page has years to show: 2019, then a gap in 2020, then one a
// year up to the Scotland trip. Enough rows for the phone's year fold and
// a multi-year barcode on the lifetime pass, each with a new country.
const REYKJAVIK_TITLE = 'Reykjavík in winter';
const COPENHAGEN_TITLE = 'Copenhagen';
const MARRAKECH_TITLE = 'Marrakech';
const HANOI_TITLE = 'Hanoi';

// Upcoming: three cities, two countries, one train and three flights.
// `now`-relative like Patagonia — it starts six weeks out on every seed
// run, so it never goes stale into a second active trip. Two of its
// stops (Pastéis de Belém, Cervejaria Ramiro) are materialised from the
// wishlist below, dated via `scheduledAt`.
const LISBON_SEGMENTS: HeroSegment[] = [
  {
    type: 'flight',
    data: {
      carrier: 'TP',
      flightNumber: '1351',
      originAirport: 'LHR',
      destinationAirport: 'LIS',
      pnr: 'IBERX4',
      seat: '12A',
    },
    startsAt: relDay(42, 7, 10),
    endsAt: relDay(42, 9, 45),
    countryCode: 'PT',
    originCountryCode: 'GB',
  },
  {
    type: 'hotel',
    data: {
      propertyName: 'Memmo Alfama',
      address: 'Travessa das Merceeiras 27, Lisbon',
      confirmationNumber: 'MA-30912',
      roomType: 'Terrace double',
      checkInTime: '14:00',
      checkOutTime: '11:00',
    },
    startsAt: relDay(42, 0),
    endsAt: relDay(45, 0),
    locationName: 'Alfama',
    countryCode: 'PT',
    pin: { lat: 38.7108, lng: -9.1311 },
  },
  {
    type: 'activity',
    data: { title: 'Tram 28 and the Alfama walk' },
    startsAt: relDay(44, 9, 30),
    locationName: 'Alfama',
    countryCode: 'PT',
    pin: { lat: 38.7118, lng: -9.1302 },
  },
  {
    type: 'transit',
    data: {
      mode: 'train',
      carrier: 'CP Alfa Pendular',
      fromName: 'Lisboa Santa Apolónia',
      toName: 'Porto Campanhã',
      referenceNumber: 'AP-133',
    },
    startsAt: relDay(45, 9),
    endsAt: relDay(45, 11, 58),
    locationName: 'Lisbon → Porto',
    countryCode: 'PT',
    pin: { lat: 41.1487, lng: -8.5855 },
    fromPin: { lat: 38.7137, lng: -9.1226 },
  },
  {
    type: 'hotel',
    data: {
      propertyName: 'The Yeatman',
      address: 'Rua do Choupelo 88, Vila Nova de Gaia',
      confirmationNumber: 'YT-5520',
      roomType: 'River view',
      checkInTime: '15:00',
      checkOutTime: '12:00',
    },
    startsAt: relDay(45, 0),
    endsAt: relDay(47, 0),
    locationName: 'Vila Nova de Gaia',
    countryCode: 'PT',
    pin: { lat: 41.1336, lng: -8.6136 },
  },
  {
    type: 'activity',
    data: { title: 'Port lodge tasting', bookingRef: 'GRAHAMS-77' },
    startsAt: relDay(46, 15),
    locationName: 'Vila Nova de Gaia',
    countryCode: 'PT',
    pin: { lat: 41.1372, lng: -8.6145 },
  },
  {
    type: 'flight',
    data: {
      carrier: 'FR',
      flightNumber: '4120',
      originAirport: 'OPO',
      destinationAirport: 'SVQ',
      pnr: 'RYSVQ9',
      seat: '7F',
    },
    startsAt: relDay(47, 10, 20),
    endsAt: relDay(47, 12, 35),
    countryCode: 'ES',
    originCountryCode: 'PT',
  },
  {
    type: 'hotel',
    data: {
      propertyName: 'Hotel Mercer Sevilla',
      address: 'Calle Castelar 26, Seville',
      confirmationNumber: 'HMS-2210',
      roomType: 'Patio room',
      checkInTime: '15:00',
      checkOutTime: '12:00',
    },
    startsAt: relDay(47, 0),
    endsAt: relDay(49, 0),
    locationName: 'Arenal',
    countryCode: 'ES',
    pin: { lat: 37.3881, lng: -5.9967 },
  },
  {
    type: 'activity',
    data: { title: 'Real Alcázar', bookingRef: 'ALC-44871' },
    startsAt: relDay(48, 9, 30),
    locationName: 'Santa Cruz',
    countryCode: 'ES',
    pin: { lat: 37.3831, lng: -5.9903 },
  },
  {
    type: 'food',
    data: { venue: 'Eslava' },
    startsAt: relDay(48, 21),
    locationName: 'San Lorenzo',
    countryCode: 'ES',
    pin: { lat: 37.3986, lng: -5.9985 },
  },
  {
    type: 'flight',
    data: {
      carrier: 'BA',
      flightNumber: '2711',
      originAirport: 'SVQ',
      destinationAirport: 'LHR',
      pnr: 'BAHOME',
      seat: '23C',
    },
    startsAt: relDay(49, 14, 5),
    endsAt: relDay(49, 15, 45),
    countryCode: 'GB',
    originCountryCode: 'ES',
  },
];

// Private trip: hut to hut, then over the Brenner into Austria.
const DOLOMITES_SEGMENTS: HeroSegment[] = [
  {
    type: 'flight',
    data: {
      carrier: 'BA',
      flightNumber: '2584',
      originAirport: 'LHR',
      destinationAirport: 'VCE',
      pnr: 'DOLO25',
      seat: '18A',
    },
    startsAt: d(2025, 6, 13, 8, 15),
    endsAt: d(2025, 6, 13, 11, 25),
    countryCode: 'IT',
    originCountryCode: 'GB',
  },
  {
    type: 'transit',
    data: {
      mode: 'train',
      carrier: 'Trenitalia',
      fromName: 'Venezia Santa Lucia',
      toName: 'Bolzano',
      referenceNumber: 'RV-2270',
    },
    startsAt: d(2025, 6, 13, 13, 20),
    endsAt: d(2025, 6, 13, 16, 45),
    locationName: 'Venice → Bolzano',
    countryCode: 'IT',
    pin: { lat: 46.4966, lng: 11.358 },
    fromPin: { lat: 45.4412, lng: 12.3208 },
  },
  {
    type: 'hotel',
    data: {
      propertyName: 'Rifugio Firenze',
      confirmationNumber: 'RF-118',
      roomType: 'Dorm bunk',
      checkInTime: '16:00',
      checkOutTime: '08:00',
    },
    startsAt: d(2025, 6, 14, 0),
    endsAt: d(2025, 6, 17, 0),
    locationName: 'Val Gardena',
    countryCode: 'IT',
    pin: { lat: 46.5967, lng: 11.7428 },
  },
  {
    type: 'activity',
    data: { title: 'Seceda ridge walk' },
    startsAt: d(2025, 6, 15, 8),
    locationName: 'Ortisei',
    countryCode: 'IT',
    pin: { lat: 46.6003, lng: 11.7242 },
  },
  {
    type: 'activity',
    data: { title: 'Lago di Braies at sunrise' },
    startsAt: d(2025, 6, 17, 6),
    locationName: 'Braies',
    countryCode: 'IT',
    pin: { lat: 46.6944, lng: 12.0857 },
  },
  {
    // Cross-border leg: one country per transit row (ADR-0019), the
    // arrival's, so the Bolzano origin keys under AT.
    type: 'transit',
    data: {
      mode: 'train',
      carrier: 'ÖBB EuroCity',
      fromName: 'Bolzano',
      toName: 'Innsbruck Hbf',
      referenceNumber: 'EC-87',
    },
    startsAt: d(2025, 6, 18, 10, 30),
    endsAt: d(2025, 6, 18, 12, 40),
    locationName: 'Bolzano → Innsbruck',
    countryCode: 'AT',
    pin: { lat: 47.2633, lng: 11.4008 },
    fromPin: { lat: 46.4966, lng: 11.358 },
  },
  {
    type: 'hotel',
    data: {
      propertyName: 'Hotel Grauer Bär',
      address: 'Universitätsstraße 5, Innsbruck',
      confirmationNumber: 'GB-9902',
      checkInTime: '14:00',
      checkOutTime: '11:00',
    },
    startsAt: d(2025, 6, 18, 0),
    endsAt: d(2025, 6, 21, 0),
    locationName: 'Innsbruck',
    countryCode: 'AT',
    pin: { lat: 47.269, lng: 11.3965 },
  },
  {
    type: 'food',
    data: { venue: 'Gasthaus Anich' },
    startsAt: d(2025, 6, 19, 19, 30),
    locationName: 'Innsbruck',
    countryCode: 'AT',
    pin: { lat: 47.2627, lng: 11.3917 },
  },
  {
    type: 'flight',
    data: {
      carrier: 'BA',
      flightNumber: '2617',
      originAirport: 'INN',
      destinationAirport: 'LHR',
      pnr: 'DOLO25',
      seat: '9F',
    },
    startsAt: d(2025, 6, 21, 16, 10),
    endsAt: d(2025, 6, 21, 17, 20),
    countryCode: 'GB',
    originCountryCode: 'AT',
  },
];

// Long-title trip: a hire car north, the ferry out to Lewis, and a
// small-plane hop home. The car leg keeps one pin (ADR-0019).
const SCOTLAND_SEGMENTS: HeroSegment[] = [
  {
    type: 'flight',
    data: {
      carrier: 'BA',
      flightNumber: '1490',
      originAirport: 'LHR',
      destinationAirport: 'INV',
      pnr: 'NC500X',
      seat: '3A',
    },
    startsAt: d(2024, 9, 6, 9),
    endsAt: d(2024, 9, 6, 10, 35),
    countryCode: 'GB',
    originCountryCode: 'GB',
  },
  {
    type: 'transit',
    data: {
      mode: 'car',
      carrier: 'Arnold Clark',
      fromName: 'Inverness Airport',
      toName: 'Ullapool',
    },
    startsAt: d(2024, 9, 6, 12),
    endsAt: d(2024, 9, 6, 14, 30),
    locationName: 'Inverness → Ullapool',
    countryCode: 'GB',
    pin: { lat: 57.8954, lng: -5.1601 },
  },
  {
    type: 'hotel',
    data: {
      propertyName: 'The Ceilidh Place',
      confirmationNumber: 'CP-4410',
      checkInTime: '15:00',
      checkOutTime: '10:00',
    },
    startsAt: d(2024, 9, 6, 0),
    endsAt: d(2024, 9, 9, 0),
    locationName: 'Ullapool',
    countryCode: 'GB',
    pin: { lat: 57.8987, lng: -5.1593 },
  },
  {
    type: 'transit',
    data: {
      mode: 'ferry',
      carrier: 'CalMac',
      fromName: 'Ullapool',
      toName: 'Stornoway',
      referenceNumber: 'CALMAC-61',
    },
    startsAt: d(2024, 9, 9, 9, 30),
    endsAt: d(2024, 9, 9, 12, 15),
    locationName: 'The Minch',
    countryCode: 'GB',
    pin: { lat: 58.2077, lng: -6.3861 },
    fromPin: { lat: 57.8951, lng: -5.1589 },
  },
  {
    type: 'activity',
    data: { title: 'Callanish Standing Stones' },
    startsAt: d(2024, 9, 10, 11),
    locationName: 'Isle of Lewis',
    countryCode: 'GB',
    pin: { lat: 58.1975, lng: -6.7453 },
  },
  {
    type: 'activity',
    data: { title: 'Luskentyre beach' },
    startsAt: d(2024, 9, 12, 14),
    locationName: 'Isle of Harris',
    countryCode: 'GB',
    pin: { lat: 57.8889, lng: -6.9411 },
  },
  {
    type: 'flight',
    data: {
      carrier: 'Loganair',
      flightNumber: 'LM465',
      originAirport: 'SYY',
      destinationAirport: 'GLA',
      pnr: 'LMSYY2',
      seat: '2C',
    },
    startsAt: d(2024, 9, 20, 15),
    endsAt: d(2024, 9, 20, 15, 55),
    countryCode: 'GB',
    originCountryCode: 'GB',
  },
];

// Builds one of the earlier trips: out and back from Heathrow with a
// single hotel in between. Same `HeroSegment` shape and pin rules.
function shortTripSegments(t: {
  carrier: string;
  outNumber: string;
  homeNumber: string;
  airport: string;
  countryCode: string;
  pnr: string;
  out: Date;
  home: Date;
  hotel: {
    propertyName: string;
    confirmationNumber: string;
    locationName: string;
    pin: FixturePin;
  };
}): HeroSegment[] {
  return [
    {
      type: 'flight',
      data: {
        carrier: t.carrier,
        flightNumber: t.outNumber,
        originAirport: 'LHR',
        destinationAirport: t.airport,
        pnr: t.pnr,
      },
      startsAt: t.out,
      endsAt: new Date(t.out.getTime() + 3 * 60 * 60 * 1000),
      countryCode: t.countryCode,
      originCountryCode: 'GB',
    },
    {
      type: 'hotel',
      data: {
        propertyName: t.hotel.propertyName,
        confirmationNumber: t.hotel.confirmationNumber,
        checkInTime: '15:00',
        checkOutTime: '11:00',
      },
      startsAt: dayOf(t.out),
      endsAt: dayOf(t.home),
      locationName: t.hotel.locationName,
      countryCode: t.countryCode,
      pin: t.hotel.pin,
    },
    {
      type: 'flight',
      data: {
        carrier: t.carrier,
        flightNumber: t.homeNumber,
        originAirport: t.airport,
        destinationAirport: 'LHR',
        pnr: t.pnr,
      },
      startsAt: t.home,
      endsAt: new Date(t.home.getTime() + 3 * 60 * 60 * 1000),
      countryCode: 'GB',
      originCountryCode: t.countryCode,
    },
  ];
}

const REYKJAVIK_SEGMENTS = shortTripSegments({
  carrier: 'FI',
  outNumber: '451',
  homeNumber: '450',
  airport: 'KEF',
  countryCode: 'IS',
  pnr: 'FIKEF1',
  out: d(2019, 2, 14, 13, 5),
  home: d(2019, 2, 18, 8, 15),
  hotel: {
    propertyName: 'Hotel Holt',
    confirmationNumber: 'HH-1902',
    locationName: 'Reykjavík',
    pin: { lat: 64.1442, lng: -21.9383, city: 'Reykjavík' },
  },
});

const COPENHAGEN_SEGMENTS = shortTripSegments({
  carrier: 'SK',
  outNumber: '1500',
  homeNumber: '1501',
  airport: 'CPH',
  countryCode: 'DK',
  pnr: 'SKCPH3',
  out: d(2021, 9, 9, 8, 40),
  home: d(2021, 9, 12, 18, 20),
  hotel: {
    propertyName: 'Hotel Sanders',
    confirmationNumber: 'SND-2109',
    locationName: 'Nyhavn',
    pin: { lat: 55.6797, lng: 12.5856, city: 'Copenhagen' },
  },
});

const MARRAKECH_SEGMENTS = shortTripSegments({
  carrier: 'BA',
  outNumber: '2650',
  homeNumber: '2651',
  airport: 'RAK',
  countryCode: 'MA',
  pnr: 'BARAK5',
  out: d(2022, 3, 18, 10, 15),
  home: d(2022, 3, 23, 15, 40),
  hotel: {
    propertyName: 'Riad Kniza',
    confirmationNumber: 'RK-2203',
    locationName: 'Medina',
    pin: { lat: 31.6342, lng: -7.9967, city: 'Marrakech' },
  },
});

const HANOI_SEGMENTS = shortTripSegments({
  carrier: 'VN',
  outNumber: '50',
  homeNumber: '51',
  airport: 'HAN',
  countryCode: 'VN',
  pnr: 'VNHAN8',
  out: d(2023, 11, 2, 11, 30),
  home: d(2023, 11, 9, 23, 55),
  hotel: {
    propertyName: 'Sofitel Legend Metropole',
    confirmationNumber: 'SLM-2311',
    locationName: 'Hoàn Kiếm',
    pin: { lat: 21.0255, lng: 105.8565, city: 'Hanoi' },
  },
});

const EARLIER_TRIPS: Array<{ title: string; summary: string; segments: HeroSegment[] }> = [
  {
    title: REYKJAVIK_TITLE,
    summary: 'A long weekend of short days and hot pools.',
    segments: REYKJAVIK_SEGMENTS,
  },
  {
    title: COPENHAGEN_TITLE,
    summary: 'Three days of bikes, harbour swims and smørrebrød.',
    segments: COPENHAGEN_SEGMENTS,
  },
  {
    title: MARRAKECH_TITLE,
    summary: 'Five nights in a riad in the medina.',
    segments: MARRAKECH_SEGMENTS,
  },
  {
    title: HANOI_TITLE,
    summary: 'A week in the Old Quarter.',
    segments: HANOI_SEGMENTS,
  },
];

// Wishlist items — the household's reusable place list. A few JP food
// + activity spots so the Japan trip's suggestions panel has something
// to surface, plus a couple of PT items materialised onto the upcoming
// Lisbon trip as dated stops. One JP food item gets materialised onto
// the hero trip as an undated wishlist-derived segment so the
// segments.wishlistItemId backref has live coverage too.
type WishlistFixture = {
  type: 'food' | 'activity';
  countryCode: string;
  locationName?: string;
  notes?: string;
  tags?: string[];
  data: Record<string, unknown>;
  /**
   * Materialise onto a specific trip as a segment — undated unless
   * `scheduledAt` is set.
   */
  materialiseOn?: 'hero' | 'lisbon';
  /**
   * Schedule the materialised copy onto a day, as the reschedule dialog
   * would after the add. Omitted keeps it undated.
   */
  scheduledAt?: Date;
};

const WISHLIST_ITEMS: WishlistFixture[] = [
  {
    type: 'food',
    countryCode: 'JP',
    locationName: 'Akasaka',
    notes: 'Book months ahead through hotel concierge.',
    tags: ['sushi', 'splurge'],
    data: { venue: 'Sushi Saito', address: 'Akasaka, Minato City, Tokyo' },
  },
  {
    type: 'food',
    countryCode: 'JP',
    locationName: 'Jingūmae',
    data: { venue: 'Den' },
    materialiseOn: 'hero',
  },
  {
    // Demonstrates Plus Code on a wishlist item — same precedence rule
    // as segments, so the card on /wishlist shows the badge alongside
    // any future trip-map pin.
    type: 'activity',
    countryCode: 'JP',
    locationName: 'Mitaka',
    notes: 'Tickets sell out — buy the moment they release.',
    data: { title: 'Ghibli Museum', plusCode: 'MQR4+9X Mitaka, Tokyo' },
  },
  {
    type: 'activity',
    countryCode: 'PT',
    locationName: 'Belém',
    data: { title: 'Pastéis de Belém', description: 'Worth the queue.' },
    materialiseOn: 'lisbon',
    scheduledAt: relDay(43, 10),
  },
  {
    type: 'food',
    countryCode: 'PT',
    locationName: 'Anjos',
    data: { venue: 'Cervejaria Ramiro' },
    materialiseOn: 'lisbon',
    scheduledAt: relDay(42, 20, 30),
  },
  {
    // THE city-line case: a full Plus Code and nothing else — no
    // address, no area label. Without the geocoder's resolved locality
    // the card can only say "South Korea", which is what #116 was
    // filed about. Also the reason KR is here: it is the country whose
    // stored name ("Korea, South") the filter must find when you type
    // "South Korea".
    type: 'food',
    countryCode: 'KR',
    tags: ['noodles'],
    data: { venue: 'Myeongdong Kyoja', plusCode: '8Q98HX7P+86' },
  },
  {
    // Country-only degradation: nothing geocodable resolves, so no
    // badge and no city. Keeps the bare fallback visible in dev.
    type: 'activity',
    countryCode: 'KR',
    notes: 'Ask the guesthouse which entrance is open in winter.',
    data: { title: 'Unnamed ridge trail — ask locally' },
  },
  {
    type: 'activity',
    countryCode: 'VN',
    locationName: 'Hội An',
    tags: ['tailor'],
    data: { title: 'Old town lantern walk', description: 'Best after sunset.' },
  },
  {
    // Activity WITH an address and no description — the card used to
    // drop the address entirely and show nothing but the title.
    type: 'activity',
    countryCode: 'IT',
    data: { title: 'Palazzo Massimo', address: 'Largo di Villa Peretti 2, Rome' },
  },
  {
    type: 'food',
    countryCode: 'MX',
    locationName: 'Roma Norte',
    data: { venue: 'Contramar' },
  },
  {
    // Second JP food item so the hero trip's suggestions panel renders
    // TWO rows — its 2-column grid, the height-equalising `h-full` chain
    // through the dialog trigger, and the name truncation had no fixture
    // coverage while every trip surfaced exactly one suggestion. Long
    // name and no area label on purpose.
    //
    // APPEND ONLY, and keep WISHLIST_PINS below in sync: those entries
    // are keyed by INDEX into this array, so inserting anywhere but the
    // end silently re-points every pin after the insert.
    type: 'food',
    countryCode: 'JP',
    notes: 'Counter seats only. Cash.',
    data: { venue: 'Toriki Hanare — reservations by referral only' },
  },
];

// Pre-geocoded wishlist items so their muted pin appears in the trip
// map's wishlist overlay, and so the card's city line has something to
// show. Keyed by index into WISHLIST_ITEMS so the cache key is derived
// through `buildGeocodeQuery` against the same shape the repo layer
// will use to look it up. Keep aligned with the matching index in
// WISHLIST_ITEMS.
//
// `city` mirrors what the provider's reverse geocode would carry — the
// segment pins above already seed it, and without it here the wishlist
// city line would look broken in a seeded worktree.
const WISHLIST_PINS: Array<{ index: number; lat: number; lng: number; city?: string }> = [
  // Sushi Saito — geocoded via address ("Akasaka, Minato City, Tokyo").
  // City suppressed on the card: the address already spells out Tokyo.
  { index: 0, lat: 35.6735, lng: 139.7374, city: 'Tokyo' },
  // Den — geocoded via "Den, Jingūmae" (no address; venue + locationName)
  { index: 1, lat: 35.6727, lng: 139.7036, city: 'Tokyo' },
  // Ghibli Museum — geocoded via "Ghibli Museum, Mitaka"
  { index: 2, lat: 35.6962, lng: 139.5704, city: 'Mitaka' },
  // Pastéis de Belém and Cervejaria Ramiro — both materialised onto the
  // Lisbon trip as dated stops, so its map needs their pins too.
  { index: 3, lat: 38.6975, lng: -9.2032, city: 'Lisbon' },
  { index: 4, lat: 38.724, lng: -9.136, city: 'Lisbon' },
  // Myeongdong Kyoja — the Plus-Code-only item. Its coords decode
  // offline; ONLY this cache row supplies the city, which is the whole
  // point of the seed.
  { index: 5, lat: 37.5633, lng: 126.9855, city: 'Seoul' },
  // Palazzo Massimo — address-only activity.
  { index: 8, lat: 41.9018, lng: 12.4983, city: 'Rome' },
  // Contramar — venue + locationName, city adds the metropolis above
  // the neighbourhood.
  { index: 9, lat: 19.4155, lng: -99.1673, city: 'Mexico City' },
];

// The production query builders take the segment row shape; `HeroSegment`
// is the fixture's input shape. Adapt here so cache keys we seed match
// the keys the read path looks up.
function placeForHeroSegment(seg: HeroSegment) {
  return {
    type: seg.type,
    data: seg.data,
    locationName: seg.locationName ?? null,
    countryCode: seg.countryCode ?? null,
  };
}

export interface FixtureGeocodeSeed {
  /** Geocoder-ready query, pre-normalisation. */
  query: string;
  pin: FixturePin | null;
}

/**
 * The geocode-cache rows the fixture seeds for its segments — one per
 * geocodable segment, or one per endpoint for a train / bus / ferry leg
 * — keyed through the production query builders so a seeded worktree
 * renders without live geocoder calls. Throws when a derived query has
 * no matching pin field (`pin`, or `fromPin` for an origin): a missing
 * seed would silently hit the public geocoders on first render. Rows are
 * deduped by cache key, and two seeds that share a key must agree.
 * Exported so the seed can be checked without a database.
 */
export function fixtureGeocodeSeeds(): FixtureGeocodeSeed[] {
  const byKey = new Map<string, FixtureGeocodeSeed>();
  for (const seg of [
    ...HERO_SEGMENTS,
    ...PATAGONIA_SEGMENTS,
    ...LISBON_SEGMENTS,
    ...DOLOMITES_SEGMENTS,
    ...SCOTLAND_SEGMENTS,
    ...EARLIER_TRIPS.flatMap((t) => t.segments),
  ]) {
    const place = placeForHeroSegment(seg);
    const endpoints = buildTransitEndpointQueries(place);
    const wanted = endpoints
      ? [
          { query: endpoints.destination, pin: seg.pin, field: 'pin' },
          { query: endpoints.origin, pin: seg.fromPin, field: 'fromPin' },
        ]
      : [{ query: buildGeocodeQuery(place), pin: seg.pin, field: 'pin' }];
    for (const { query, pin, field } of wanted) {
      if (!query) continue;
      if (pin === undefined) {
        throw new Error(
          `Fixture ${seg.type} segment derives geocode query "${query}" but has no ${field} — add one, or ${field}: null for an ungeocoded edge case.`,
        );
      }
      const key = normalizeQuery(query);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { query, pin });
      } else if (existing.pin?.lat !== pin?.lat || existing.pin?.lng !== pin?.lng) {
        throw new Error(`Fixture seeds disagree on the pin for geocode query "${query}".`);
      }
    }
  }
  return [...byKey.values()];
}

export interface FixturePayload {
  userId: string;
  /** The rich "hero" trip (Tokyo & Kyoto) — used for deep links. */
  detailTripId: string;
  trips: Array<{ id: string; title: string; status: string }>;
}

/**
 * Build (or rebuild) the full synthetic dataset under the fixture user.
 * Idempotent: clears any prior fixture data first.
 */
export async function buildFixtureDataset(pool: Pool): Promise<FixturePayload> {
  // Wrap the whole rebuild in a single transaction so a failure mid-
  // sequence rolls back to the previous fixture state (or to empty,
  // for a first run) rather than leaving the fixture user
  // half-wiped. The body lives in `rebuildInTx` so the existing
  // indentation stays flat — the drizzle transaction handle has the
  // same query API as the base client.
  return drizzle(pool).transaction(rebuildInTx);
}

type DbHandle = Parameters<Parameters<ReturnType<typeof drizzle>['transaction']>[0]>[0];

async function rebuildInTx(db: DbHandle): Promise<FixturePayload> {
  // 0) Reference data — the FK targets for segment / visited-country
  //    country codes. Idempotent; a no-op once `pnpm db:seed` has run.
  await db
    .insert(countries)
    .values([...ISO_COUNTRIES])
    .onConflictDoNothing();

  // 1) User: upsert by sub.
  const existing = await db.select().from(users).where(eq(users.sub, FIXTURE_SUB)).limit(1);
  let userId: string;
  if (existing[0]) {
    userId = existing[0].id;
  } else {
    const [row] = await db
      .insert(users)
      .values({
        sub: FIXTURE_SUB,
        email: FIXTURE_EMAIL,
        name: 'Atlas Demo User',
        emailVerified: new Date(),
      })
      .returning({ id: users.id });
    if (!row) throw new Error('user insert returned no row');
    userId = row.id;
  }

  // Notifications on, default topic, every category on — so a dev stack
  // with the `notifications` compose profile (and NTFY_URL / NTFY_TOPIC
  // pointing at it) pushes for the fixture user straight away. Reset on
  // every run so a settings change made while testing doesn't stick.
  await db
    .update(users)
    .set({ notificationsEnabled: true, ntfyTopic: null, notificationPrefs: {} })
    .where(eq(users.id, userId));

  // 2) Wipe any previous fixture data for a clean rebuild.
  //    Order: documents → trips → wishlist items → visited countries
  //    → sessions. Documents cascade their link rows, trips cascade
  //    segments (and the remaining `document_segments` rows, and
  //    materialised wishlist-backed segments — `wishlist_item_id` is
  //    ON DELETE SET NULL, but those segments belong to the trip
  //    being cascaded anyway). Wishlist items reference users.id with
  //    ON DELETE RESTRICT, so they have to be cleared explicitly
  //    before any future user-row touch. The remaining side tables
  //    just FK to userId and are safe to clear last.
  await db.delete(documents).where(eq(documents.userId, userId));
  await db.delete(trips).where(eq(trips.userId, userId));
  await db.delete(wishlistItems).where(eq(wishlistItems.createdBy, userId));
  await db.delete(userVisitedCountries).where(eq(userVisitedCountries.userId, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));

  // 3) Trips — one rich "hero" trip plus eight lighter ones so the
  //    list view (and the stats page's years) carries weight. Statuses span planned / active /
  //    completed; dates are fixed except the active and upcoming
  //    trips', which ride `relDay` so they never go stale.
  const [hero] = await db
    .insert(trips)
    .values({
      userId,
      title: 'Tokyo & Kyoto',
      summary: 'A week in Japan. A few days in Tokyo, then the train down to Kyoto.',
      status: 'completed',
      startDate: d(2025, 10, 4),
      endDate: d(2025, 10, 10),
    })
    .returning({ id: trips.id });
  if (!hero) throw new Error('hero trip insert returned no row');

  const otherTripsInserted = await db
    .insert(trips)
    .values([
      {
        userId,
        title: LISBON_TITLE,
        summary: 'A week down the coast: Lisbon, the train to Porto, then a hop over to Seville.',
        status: 'planned',
        startDate: relDay(42),
        endDate: relDay(49),
      },
      {
        userId,
        title: PATAGONIA_TITLE,
        summary:
          'Eight days in Patagonia, hiking the W trek in Torres del Paine, out via Buenos Aires.',
        status: 'active',
        // `now`-relative so the active trip always straddles today —
        // see PATAGONIA_SEGMENTS and the `relDay` note above. Ends relDay(4)
        // to cover the onward Santiago leg (the same-day flight→hotel demo)
        // and the morning hop to Buenos Aires.
        startDate: relDay(-3),
        endDate: relDay(4),
      },
      {
        userId,
        title: DOLOMITES_TITLE,
        summary: 'Hut to hut in the Dolomites, then the train over the Brenner to Innsbruck.',
        status: 'completed',
        // Opted out of household sharing (ADR-0015) so the dev view shows
        // the "Private" badge + the form's Private state. Every other
        // trip keeps the default 'household' visibility.
        visibility: 'private',
        startDate: d(2025, 6, 13),
        endDate: d(2025, 6, 21),
      },
      {
        // Deliberately long title (and a second past year) — exercises the
        // trip card's title wrapping on phone and the year-group spacing
        // across two completed years on the dashboard.
        userId,
        title: SCOTLAND_TITLE,
        summary: 'A slow loop up the NC500 and out to Lewis and Harris.',
        status: 'completed',
        startDate: d(2024, 9, 6),
        endDate: d(2024, 9, 20),
      },
      // The earlier trips: dated from their first and last flights.
      ...EARLIER_TRIPS.map((t) => ({
        userId,
        title: t.title,
        summary: t.summary,
        status: 'completed' as const,
        startDate: dayOf(t.segments[0]!.startsAt!),
        endDate: dayOf(t.segments.at(-1)!.startsAt!),
      })),
    ])
    .returning({ id: trips.id, title: trips.title });
  const tripIdByTitle = (title: string): string => {
    const id = otherTripsInserted.find((t) => t.title === title)?.id;
    if (!id) throw new Error(`Fixture trip "${title}" insert returned no row`);
    return id;
  };
  const lisbonTripId = tripIdByTitle(LISBON_TITLE);

  // 4) Hero itinerary — segments. RETURNING keeps insert order so we
  //    can wire documents to the right flight / hotel rows below.
  const insertedSegments = await db
    .insert(segments)
    .values(
      HERO_SEGMENTS.map((s) => ({
        tripId: hero.id,
        type: s.type,
        data: s.data,
        startsAt: s.startsAt ?? null,
        endsAt: s.endsAt ?? null,
        locationName: s.locationName ?? null,
        countryCode: s.countryCode ?? null,
        originCountryCode: s.originCountryCode ?? null,
        needsReview: s.needsReview ?? false,
      })),
    )
    .returning({ id: segments.id, type: segments.type });

  // 4b) Side-trip itineraries — the active trip's `now`-relative
  //     segments, so the chronological map's active-trip behaviours are
  //     demonstrable in a worktree, plus the other side trips. No
  //     documents are wired to these; they only need to exist on the
  //     map + itinerary.
  const sideTripSegments: Array<[string, HeroSegment[]]> = [
    [PATAGONIA_TITLE, PATAGONIA_SEGMENTS],
    [LISBON_TITLE, LISBON_SEGMENTS],
    [DOLOMITES_TITLE, DOLOMITES_SEGMENTS],
    [SCOTLAND_TITLE, SCOTLAND_SEGMENTS],
    ...EARLIER_TRIPS.map((t): [string, HeroSegment[]] => [t.title, t.segments]),
  ];
  for (const [title, tripSegments] of sideTripSegments) {
    const tripId = tripIdByTitle(title);
    await db.insert(segments).values(
      tripSegments.map((s) => ({
        tripId,
        type: s.type,
        data: s.data,
        startsAt: s.startsAt ?? null,
        endsAt: s.endsAt ?? null,
        locationName: s.locationName ?? null,
        countryCode: s.countryCode ?? null,
        originCountryCode: s.originCountryCode ?? null,
        needsReview: s.needsReview ?? false,
      })),
    );
  }

  // 5) Geocode cache — positive rows for every pinned segment and
  //    negative rows for the deliberately-ungeocoded edge cases.
  //    Positive TTL matches the production 90d hit TTL, null TTL the
  //    7d miss TTL (ADR-0010); the values are advisory in fixture
  //    use (prune sweeps run if anyone enables them), but lining them
  //    up means a manual prune on a worktree behaves as documented.
  const positiveExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const nullExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  for (const { query, pin } of fixtureGeocodeSeeds()) {
    // Station keys (ADR-0019) carry the typed name — show that, not the
    // key, wherever the row's display name surfaces.
    const station = tryParseStationQuery(query);
    const displayName = pin ? (station?.name ?? query) : null;
    const expiresAt = pin ? positiveExpiresAt : nullExpiresAt;
    // Which rung of the ladder "produced" the row. The trip map's
    // fallback distance guard reads it, so a re-seed must rewrite it.
    const source = pin?.source ?? (pin && station ? 'photon-station' : 'nominatim');
    await db
      .insert(geocodeCache)
      .values({
        queryNormalized: normalizeQuery(query),
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
        displayName,
        city: pin?.city ?? null,
        source,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: geocodeCache.queryNormalized,
        set: {
          lat: pin?.lat ?? null,
          lng: pin?.lng ?? null,
          displayName,
          city: pin?.city ?? null,
          source,
          expiresAt,
        },
      });
  }

  // 6) Documents — a boarding pass (two legs) and a hotel email, each
  //    carrying an extracted structured payload, linked to the segments
  //    they describe. Object keys point at files that don't exist on
  //    disk; the Documents tab only lists rows, it doesn't read the
  //    originals.
  const flightSegmentIds = insertedSegments.filter((s) => s.type === 'flight').map((s) => s.id);
  const hotelSegmentIds = insertedSegments.filter((s) => s.type === 'hotel').map((s) => s.id);
  // Nazuna Kyoto Gosho is the second hotel inserted (Hotel Niwa Tokyo
  // is the first; "Guest house — TBC" is the third).
  const nazunaSegmentId = hotelSegmentIds[1];

  const [boardingDoc] = await db
    .insert(documents)
    .values({
      userId,
      tripId: hero.id,
      objectKey: `2025/10/${randomUUID()}.pdf`,
      mime: 'application/pdf',
      bytes: 88231,
      sha256: 'fixture-boarding-pass-jl42-jl43',
      // Cryptic booking-system filename + a user-set display title —
      // exercises the #102 rename path; the hotel doc below stays
      // title-less to cover the filename-fallback rendering.
      originalName: 'e-ticket_0821744736_XPRKQZ_final(1).pdf',
      title: 'JAL boarding passes — LHR ⇄ Kansai',
      parsed: {
        kind: 'boarding-pass',
        flights: [
          {
            carrier: 'JL',
            flightNumber: '42',
            flightDate: '2025-10-04',
            scheduledDeparture: '2025-10-04T11:05',
            scheduledArrival: '2025-10-05T08:55',
            origin: 'LHR',
            destination: 'HND',
            passengerName: 'Atlas Demo User',
            confirmationCode: 'ATLAS7',
          },
          {
            carrier: 'JL',
            flightNumber: '43',
            flightDate: '2025-10-10',
            scheduledDeparture: '2025-10-10T11:40',
            scheduledArrival: '2025-10-10T16:20',
            origin: 'KIX',
            destination: 'LHR',
            passengerName: 'Atlas Demo User',
            confirmationCode: 'ATLAS7',
          },
        ],
        confidence: 0.95,
      },
      parsedConfidence: 0.95,
      parsedBy: 'llm-local',
      textMethod: 'pdf-text',
      reviewStatus: 'confirmed',
      createdAt: d(2025, 9, 19),
    })
    .returning({ id: documents.id });

  const [hotelDoc] = await db
    .insert(documents)
    .values({
      userId,
      tripId: hero.id,
      objectKey: `2025/10/${randomUUID()}.eml`,
      mime: 'message/rfc822',
      bytes: 21044,
      sha256: 'fixture-hotel-confirmation-nazuna',
      originalName: 'nazuna-kyoto.eml',
      parsed: {
        kind: 'hotel-confirmation',
        hotelName: 'Nazuna Kyoto Gosho',
        checkIn: '2025-10-07',
        checkOut: '2025-10-10',
        address: '185 Kamariyacho, Kamigyo Ward, Kyoto',
        confirmationCode: 'NZ-4471',
        country: 'JP',
        confidence: 0.9,
      },
      parsedConfidence: 0.9,
      parsedBy: 'llm-local',
      textMethod: 'email',
      reviewStatus: 'confirmed',
      createdAt: d(2025, 9, 26),
    })
    .returning({ id: documents.id });

  // 6b) A dangling document — extraction ran but couldn't produce a
  //     structured payload (#103's origin story). No parsed payload,
  //     no segment links: exercises the attach flow in the segment
  //     info dialog and the error state on the Documents tab.
  await db.insert(documents).values({
    userId,
    tripId: hero.id,
    objectKey: `2025/10/${randomUUID()}.pdf`,
    mime: 'application/pdf',
    bytes: 143002,
    sha256: 'fixture-dangling-ryokan-voucher',
    originalName: 'BKG-CNF_88113349_v2_FINAL.pdf',
    parsed: null,
    extractionError: 'llm-invalid-json',
    reviewStatus: 'pending',
    createdAt: d(2025, 9, 27),
  });

  // 7) Document ↔ segment links — drives the "· linked" marker.
  const links: Array<{ documentId: string; segmentId: string }> = [];
  if (boardingDoc) {
    for (const segmentId of flightSegmentIds) {
      links.push({ documentId: boardingDoc.id, segmentId });
    }
  }
  if (hotelDoc && nazunaSegmentId) {
    links.push({ documentId: hotelDoc.id, segmentId: nazunaSegmentId });
  }
  if (links.length > 0) {
    await db.insert(documentSegments).values(links).onConflictDoNothing();
  }

  // 8) Wishlist items — household reusable place list, plus the
  //    items materialised onto trips as wishlist segments — undated
  //    (ADR-0003) unless `scheduledAt` dates them.
  const insertedWishlist = await db
    .insert(wishlistItems)
    .values(
      WISHLIST_ITEMS.map((w) => ({
        type: w.type,
        countryCode: w.countryCode,
        locationName: w.locationName ?? null,
        notes: w.notes ?? null,
        tags: w.tags ?? [],
        data: w.data,
        createdBy: userId,
      })),
    )
    .returning({ id: wishlistItems.id, type: wishlistItems.type, data: wishlistItems.data });

  // Geocode cache for wishlist items that have pre-known coordinates.
  // Routed through `buildGeocodeQuery` so the cache key matches what
  // the wishlist overlay (`getWishlistOverlayForTrip` in
  // src/lib/trip-map/repo.ts) and the lifecycle hook produce for the
  // same item. Missing this means the overlay silently drops the pin.
  for (const pin of WISHLIST_PINS) {
    const item = WISHLIST_ITEMS[pin.index];
    if (!item) continue;
    const query = buildGeocodeQuery({
      type: item.type,
      data: item.data,
      locationName: item.locationName ?? null,
      countryCode: item.countryCode ?? null,
    });
    if (!query) continue;
    await db
      .insert(geocodeCache)
      .values({
        queryNormalized: normalizeQuery(query),
        lat: pin.lat,
        lng: pin.lng,
        displayName: query,
        city: pin.city ?? null,
        source: 'nominatim',
        expiresAt: positiveExpiresAt,
      })
      .onConflictDoUpdate({
        target: geocodeCache.queryNormalized,
        set: {
          lat: pin.lat,
          lng: pin.lng,
          displayName: query,
          city: pin.city ?? null,
          expiresAt: positiveExpiresAt,
        },
      });
  }

  // Materialise selected wishlist items onto their target trips.
  // Materialisation is a verbatim copy of the wishlist data + the
  // wishlistItemId backref + startsAt=null (ADR-0003: per-trip
  // wishlist state), unless `scheduledAt` dates the copy.
  const materialiseRows: Array<{
    tripId: string;
    type: 'food' | 'activity';
    data: Record<string, unknown>;
    startsAt: Date | null;
    locationName: string | null;
    countryCode: string | null;
    wishlistItemId: string;
  }> = [];
  WISHLIST_ITEMS.forEach((w, idx) => {
    if (!w.materialiseOn) return;
    const inserted = insertedWishlist[idx];
    if (!inserted) return;
    const targetTripId = w.materialiseOn === 'hero' ? hero.id : lisbonTripId;
    materialiseRows.push({
      tripId: targetTripId,
      type: w.type,
      data: w.data,
      startsAt: w.scheduledAt ?? null,
      locationName: w.locationName ?? null,
      countryCode: w.countryCode,
      wishlistItemId: inserted.id,
    });
  });
  if (materialiseRows.length > 0) {
    await db.insert(segments).values(materialiseRows);
  }

  // 9) World-map choropleth — manual visited-country marks.
  await db
    .insert(userVisitedCountries)
    .values(VISITED_COUNTRIES.map((countryCode) => ({ userId, countryCode })))
    .onConflictDoNothing();

  // 10) Re-read the trips so callers can build deep links without
  //     parsing IDs from the page. ORDER BY keeps the returned list
  //     stable across runs — the screenshot-capture script and any
  //     future fixture consumer can rely on positional access.
  const persisted = await db
    .select({ id: trips.id, title: trips.title, status: trips.status })
    .from(trips)
    .where(eq(trips.userId, userId))
    .orderBy(asc(trips.startDate), asc(trips.id));

  return { userId, detailTripId: hero.id, trips: persisted };
}

/**
 * Insert a fresh Auth.js session row for the fixture user and return
 * the opaque session token. Callers print or persist this so a
 * headless browser (or a developer pasting into devtools) can sign in
 * without going through the OIDC flow.
 */
export async function createFixtureSession(pool: Pool, userId: string): Promise<string> {
  const db = drizzle(pool);
  const sessionToken = `fixture.${randomUUID()}.${randomBytes(16).toString('hex')}`;
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ sessionToken, userId, expires });
  return sessionToken;
}
