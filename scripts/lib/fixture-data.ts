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
// `UNGEOCODED_CACHE_NULLS` here so the dataset stays a useful smoke
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
import { normalizeForGeocoder } from '../../src/lib/geocoding/normalize-for-geocoder';
import { buildGeocodeQuery } from '../../src/lib/geocoding/segment-query';

export const FIXTURE_SUB = 'screenshot-fixture-user';
export const FIXTURE_EMAIL = 'screenshot@atlas.local';

// UTC date helper — keeps the itinerary's day boundaries stable
// regardless of the machine timezone the capture runs on.
const d = (y: number, m: number, day: number, h = 12, min = 0): Date =>
  new Date(Date.UTC(y, m - 1, day, h, min));

// `now`-relative UTC date helper. The screenshots use fixed dates (the
// hero trip), but the *active* trip below must straddle "today" on
// every seed run so the chronological-map behaviours — collapsed-past,
// auto-scroll-to-today, and per-day focus (issue #9) — are always
// demonstrable in a dev worktree. `offsetDays` is relative to the UTC
// start of the day the seed runs.
const relDay = (offsetDays: number, h = 12, min = 0): Date => {
  const base = new Date();
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offsetDays, h, min),
  );
};

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
// Segments without a `pin` AND without a matching cache row in
// `UNGEOCODED_CACHE_NULLS` would fall through to a live Nominatim call;
// that's intentional only for new edge cases — anything we want pinned
// on the demo map needs a `pin` here.
type HeroSegment = {
  type: 'flight' | 'hotel' | 'activity' | 'transit' | 'note';
  data: Record<string, unknown>;
  startsAt: Date;
  endsAt?: Date;
  locationName?: string;
  countryCode?: string;
  originCountryCode?: string;
  /** Lat/lng the geocode cache should return for this segment's query. */
  pin?: { lat: number; lng: number };
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
    },
    startsAt: d(2025, 10, 5),
    endsAt: d(2025, 10, 7),
    locationName: 'Chiyoda',
    countryCode: 'JP',
    pin: { lat: 35.6968, lng: 139.7536 },
  },
  {
    type: 'activity',
    data: { title: 'Sensō-ji' },
    startsAt: d(2025, 10, 5, 7),
    locationName: 'Asakusa',
    countryCode: 'JP',
    pin: { lat: 35.7148, lng: 139.7967 },
  },
  {
    type: 'activity',
    data: { title: 'teamLab Planets', bookingRef: 'TLB-7782' },
    startsAt: d(2025, 10, 6, 10),
    locationName: 'Toyosu',
    countryCode: 'JP',
    pin: { lat: 35.6499, lng: 139.7906 },
  },
  // Ungeocoded edge case: an activity at a friend's place with no
  // public address. Its geocode query nulls in the cache (see
  // UNGEOCODED_CACHE_NULLS), so it surfaces in the trip map's
  // "Not pinned" chip without making a live Nominatim call.
  {
    type: 'activity',
    data: { title: "Friend's place — drinks" },
    startsAt: d(2025, 10, 6, 19),
    countryCode: 'JP',
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
  },
  {
    type: 'hotel',
    data: {
      propertyName: 'Nazuna Kyoto Gosho',
      address: '185 Kamariyacho, Kamigyo Ward, Kyoto 602-0917',
      confirmationNumber: 'NZ-4471',
      roomType: 'Machiya suite',
    },
    startsAt: d(2025, 10, 7),
    endsAt: d(2025, 10, 10),
    locationName: 'Kamigyō',
    countryCode: 'JP',
    pin: { lat: 35.0292, lng: 135.7592 },
  },
  // Second ungeocoded edge case: a hotel with no address on file. The
  // geocode query is the property name alone, and that's pre-cached as
  // null so the chip count reads two.
  {
    type: 'hotel',
    data: {
      propertyName: 'Guest house — TBC',
      confirmationNumber: 'TBC-0001',
    },
    startsAt: d(2025, 10, 9),
    endsAt: d(2025, 10, 10),
    countryCode: 'JP',
  },
  {
    type: 'activity',
    data: { title: 'Fushimi Inari' },
    startsAt: d(2025, 10, 8, 7, 30),
    locationName: 'Fushimi',
    countryCode: 'JP',
    pin: { lat: 34.9671, lng: 135.7727 },
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
];

// --- Active trip: Patagonia, dated relative to "now" ------------------
//
// The hero trip is `completed`, so it can't exercise the chronological
// map's active-trip behaviours (issue #9): collapsed-past, auto-scroll-
// to-today, and per-day focus all fire ONLY for an `active` trip whose
// days span past + today + future. This set is dated with `relDay` so
// it always straddles whatever day the seed runs. It includes a multi-
// day hotel that started in the past and runs through today (the
// splitCollapsedDays "ongoing segment" rule) and one ungeocoded item.
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
    // Ongoing as of today, so splitCollapsedDays keeps its day (and
    // every later live day) out of the collapsed pill.
    type: 'hotel',
    data: {
      propertyName: 'Hotel Las Torres',
      address: 'Torres del Paine National Park, Magallanes, Chile',
      confirmationNumber: 'HLT-5521',
      roomType: 'Mountain-view double',
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
  },
  {
    // Future — a preview day, rendered but past the today anchor.
    type: 'transit',
    data: {
      mode: 'ferry',
      carrier: 'Hielos Patagónicos',
      fromName: 'Pudeto',
      toName: 'Refugio Paine Grande',
      referenceNumber: 'FERRY-77',
    },
    startsAt: relDay(2, 10),
    endsAt: relDay(2, 10, 30),
    locationName: 'Lago Pehoé',
    countryCode: 'CL',
    pin: { lat: -51.06, lng: -73.07 },
  },
];

// Negative geocode-cache rows so the deliberately-ungeocoded segments
// above never hit Nominatim during fixture rendering. Queries here must
// match what `buildGeocodeQuery` would produce for the segment above,
// pre-normalisation. Keep this list aligned with the no-pin entries in
// HERO_SEGMENTS and PATAGONIA_SEGMENTS.
const UNGEOCODED_CACHE_NULLS: string[] = [
  // Activity "Friend's place — drinks" — no locationName, so the query
  // is the title alone.
  "Friend's place — drinks",
  // Hotel "Guest house — TBC" — no address, so the query is the
  // property name alone.
  'Guest house — TBC',
  // Patagonia activity "Ranger's cabin — gear swap" — no locationName,
  // so the query is the title alone.
  "Ranger's cabin — gear swap",
];

// Wishlist items — the household's reusable place list. A few JP food
// + activity spots so the Japan trip's suggestions panel has something
// to surface, plus a couple of PT items that get a chance to be added
// to the upcoming Lisbon trip. One JP food item gets materialised onto
// the hero trip as a wishlist-derived segment so the
// segments.wishlistItemId backref has live coverage too.
type WishlistFixture = {
  type: 'food' | 'activity';
  countryCode: string;
  locationName?: string;
  notes?: string;
  data: Record<string, unknown>;
  /** Materialise onto a specific trip as a startsAt=null segment. */
  materialiseOn?: 'hero' | 'lisbon';
};

const WISHLIST_ITEMS: WishlistFixture[] = [
  {
    type: 'food',
    countryCode: 'JP',
    locationName: 'Akasaka',
    notes: 'Book months ahead through hotel concierge.',
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
  },
  {
    type: 'food',
    countryCode: 'PT',
    locationName: 'Cais do Sodré',
    data: { venue: 'Cervejaria Ramiro' },
  },
];

// Pre-geocoded wishlist items so their muted pin appears in the trip
// map's wishlist overlay. Keyed by index into WISHLIST_ITEMS so the
// cache key is derived through `buildGeocodeQuery` against the same
// shape the repo layer will use to look it up. Keep aligned with the
// matching index in WISHLIST_ITEMS.
const WISHLIST_PINS: Array<{ index: number; lat: number; lng: number }> = [
  // Sushi Saito — geocoded via address ("Akasaka, Minato City, Tokyo")
  { index: 0, lat: 35.6735, lng: 139.7374 },
  // Den — geocoded via "Den, Jingūmae" (no address; venue + locationName)
  { index: 1, lat: 35.6727, lng: 139.7036 },
  // Ghibli Museum — geocoded via "Ghibli Museum, Mitaka"
  { index: 2, lat: 35.6962, lng: 139.5704 },
];

// `buildGeocodeQuery` (the production helper imported above) needs the
// segment row shape; `HeroSegment` is the fixture's input shape. Adapt
// here so cache keys we seed match the keys the read path looks up.
function queryForHeroSegment(seg: HeroSegment): string | null {
  return buildGeocodeQuery({
    type: seg.type,
    data: seg.data,
    locationName: seg.locationName ?? null,
  });
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

  // 3) Trips — one rich "hero" trip plus three lighter ones so the
  //    list view carries weight. Statuses span planned / active /
  //    completed; dates are relative to a 2026-05 capture.
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
        title: 'Lisbon',
        summary: 'A few days in Lisbon. Flights are booked, nothing else planned yet.',
        status: 'planned',
        startDate: d(2026, 7, 9),
        endDate: d(2026, 7, 14),
      },
      {
        userId,
        title: 'Patagonia',
        summary: 'Two weeks in Patagonia, hiking the W trek in Torres del Paine.',
        status: 'active',
        // `now`-relative so the active trip always straddles today —
        // see PATAGONIA_SEGMENTS and the `relDay` note above.
        startDate: relDay(-3),
        endDate: relDay(2),
      },
      {
        userId,
        title: 'Dolomites',
        summary: 'A week hiking hut to hut in the Dolomites.',
        status: 'completed',
        startDate: d(2025, 6, 13),
        endDate: d(2025, 6, 21),
      },
      {
        // Deliberately long title (and a second past year) — exercises the
        // trip card's title wrapping on phone and the year-group spacing
        // across two completed years on the dashboard.
        userId,
        title: 'A Long Way Round the North Coast of Scotland and the Outer Hebrides',
        summary: 'A slow loop up the NC500 and out to Lewis and Harris.',
        status: 'completed',
        startDate: d(2024, 9, 6),
        endDate: d(2024, 9, 20),
      },
    ])
    .returning({ id: trips.id, title: trips.title });
  const lisbonTripId = otherTripsInserted.find((t) => t.title === 'Lisbon')?.id;
  const patagoniaTripId = otherTripsInserted.find((t) => t.title === 'Patagonia')?.id;

  // 4) Hero itinerary — segments. RETURNING keeps insert order so we
  //    can wire documents to the right flight / hotel rows below.
  const insertedSegments = await db
    .insert(segments)
    .values(
      HERO_SEGMENTS.map((s) => ({
        tripId: hero.id,
        type: s.type,
        data: s.data,
        startsAt: s.startsAt,
        endsAt: s.endsAt ?? null,
        locationName: s.locationName ?? null,
        countryCode: s.countryCode ?? null,
        originCountryCode: s.originCountryCode ?? null,
      })),
    )
    .returning({ id: segments.id, type: segments.type });

  // 4b) Active-trip (Patagonia) itinerary — `now`-relative segments so
  //     the chronological map's active-trip behaviours are demonstrable
  //     in a worktree. No documents are wired to these; they only need
  //     to exist on the map + itinerary.
  if (patagoniaTripId) {
    await db.insert(segments).values(
      PATAGONIA_SEGMENTS.map((s) => ({
        tripId: patagoniaTripId,
        type: s.type,
        data: s.data,
        startsAt: s.startsAt,
        endsAt: s.endsAt ?? null,
        locationName: s.locationName ?? null,
        countryCode: s.countryCode ?? null,
        originCountryCode: s.originCountryCode ?? null,
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
  for (const seg of [...HERO_SEGMENTS, ...PATAGONIA_SEGMENTS]) {
    if (!seg.pin) continue;
    const query = queryForHeroSegment(seg);
    if (!query) continue;
    await db
      .insert(geocodeCache)
      .values({
        queryNormalized: normalizeQuery(normalizeForGeocoder(query)),
        lat: seg.pin.lat,
        lng: seg.pin.lng,
        displayName: query,
        source: 'nominatim',
        expiresAt: positiveExpiresAt,
      })
      .onConflictDoUpdate({
        target: geocodeCache.queryNormalized,
        set: {
          lat: seg.pin.lat,
          lng: seg.pin.lng,
          displayName: query,
          expiresAt: positiveExpiresAt,
        },
      });
  }
  for (const nullQuery of UNGEOCODED_CACHE_NULLS) {
    await db
      .insert(geocodeCache)
      .values({
        queryNormalized: normalizeQuery(normalizeForGeocoder(nullQuery)),
        lat: null,
        lng: null,
        displayName: null,
        source: 'nominatim',
        expiresAt: nullExpiresAt,
      })
      .onConflictDoUpdate({
        target: geocodeCache.queryNormalized,
        set: { lat: null, lng: null, displayName: null, expiresAt: nullExpiresAt },
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
      originalName: 'tokyo-itinerary.pdf',
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
  //    one-or-two items materialised onto trips as startsAt=null
  //    wishlist segments (ADR-0003).
  const insertedWishlist = await db
    .insert(wishlistItems)
    .values(
      WISHLIST_ITEMS.map((w) => ({
        type: w.type,
        countryCode: w.countryCode,
        locationName: w.locationName ?? null,
        notes: w.notes ?? null,
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
    });
    if (!query) continue;
    await db
      .insert(geocodeCache)
      .values({
        queryNormalized: normalizeQuery(normalizeForGeocoder(query)),
        lat: pin.lat,
        lng: pin.lng,
        displayName: query,
        source: 'nominatim',
        expiresAt: positiveExpiresAt,
      })
      .onConflictDoUpdate({
        target: geocodeCache.queryNormalized,
        set: { lat: pin.lat, lng: pin.lng, displayName: query, expiresAt: positiveExpiresAt },
      });
  }

  // Materialise selected wishlist items onto their target trips.
  // Materialisation is a verbatim copy of the wishlist data + the
  // wishlistItemId backref + startsAt=null (ADR-0003: per-trip
  // wishlist state).
  const materialiseRows: Array<{
    tripId: string;
    type: 'food' | 'activity';
    data: Record<string, unknown>;
    locationName: string | null;
    countryCode: string | null;
    wishlistItemId: string;
  }> = [];
  WISHLIST_ITEMS.forEach((w, idx) => {
    if (!w.materialiseOn) return;
    const inserted = insertedWishlist[idx];
    if (!inserted) return;
    const targetTripId = w.materialiseOn === 'hero' ? hero.id : lisbonTripId;
    if (!targetTripId) return;
    materialiseRows.push({
      tripId: targetTripId,
      type: w.type,
      data: w.data,
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
