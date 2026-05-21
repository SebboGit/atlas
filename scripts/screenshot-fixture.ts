// One-off fixture for the documentation screenshots in docs/screenshots/.
//
// Builds a fully SYNTHETIC demo dataset under an isolated fixture user
// (keyed by a fixed `sub`), then prints a valid Auth.js session token so
// scripts/capture-screenshots.ts can drive a headless browser through
// every documented surface. Nothing in this file is real travel data —
// every trip, segment, document, address, and name is invented.
//
// The dataset is deliberately rich enough to exercise all six captured
// surfaces:
//   - a 4-trip list spanning planned / active / completed
//   - one "hero" trip (Japan) with a full multi-day itinerary, two
//     extracted documents, flight arcs, and geocoded map pins
//   - a spread of visited countries for the world-map choropleth
//
// Re-running is safe: the fixture user's trips, documents, sessions, and
// manual country marks are wiped and rebuilt every time.
//
// Prints JSON to stdout: { sessionToken, userId, detailTripId, trips }.

import { randomBytes, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

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
} from '../src/db/schema';
import { ISO_COUNTRIES } from '../src/lib/countries/data';
import { normalizeQuery } from '../src/lib/geocoding/normalize';

const FIXTURE_SUB = 'screenshot-fixture-user';
const FIXTURE_EMAIL = 'screenshot@atlas.local';

// UTC date helper — keeps the itinerary's day boundaries stable
// regardless of the machine timezone the capture runs on.
const d = (y: number, m: number, day: number, h = 12, min = 0): Date =>
  new Date(Date.UTC(y, m - 1, day, h, min));

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
    type: 'hotel',
    data: {
      propertyName: 'Hotel Niwa Tokyo',
      address: '1-1-16 Misakicho, Chiyoda City, Tokyo 101-0061',
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

// Geocode query for a non-flight hero segment — mirrors buildGeocodeQuery
// in src/lib/geocoding/segment-query.ts so the cache key we seed matches
// what the trip-map repo will look up. Replicated (not imported) to keep
// this script free of the segments module's transitive imports.
function geoQueryFor(seg: HeroSegment): string | null {
  if (seg.type === 'hotel') {
    const address = (seg.data.address as string | undefined)?.trim();
    return address || (seg.data.propertyName as string);
  }
  if (seg.type === 'activity') {
    const parts = [seg.data.title as string];
    const loc = seg.locationName?.trim();
    if (loc) parts.push(loc);
    return parts.join(', ');
  }
  if (seg.type === 'transit') {
    const to = (seg.data.toName as string | undefined)?.trim();
    const from = (seg.data.fromName as string | undefined)?.trim();
    return to || from || null;
  }
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  try {
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

    // 2) Wipe any previous fixture data for a clean rebuild. Documents
    //    first (their link rows cascade), then trips (segments + their
    //    link rows + locations cascade), then the per-user side tables.
    await db.delete(documents).where(eq(documents.userId, userId));
    await db.delete(trips).where(eq(trips.userId, userId));
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

    await db.insert(trips).values([
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
        startDate: d(2026, 5, 15),
        endDate: d(2026, 5, 27),
      },
      {
        userId,
        title: 'Dolomites',
        summary: 'A week hiking hut to hut in the Dolomites.',
        status: 'completed',
        startDate: d(2025, 6, 13),
        endDate: d(2025, 6, 21),
      },
    ]);

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

    // 5) Geocode cache — pre-resolve every non-flight pin so the trip
    //    map renders without a single Nominatim call.
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    for (const seg of HERO_SEGMENTS) {
      if (!seg.pin) continue;
      const query = geoQueryFor(seg);
      if (!query) continue;
      await db
        .insert(geocodeCache)
        .values({
          queryNormalized: normalizeQuery(query),
          lat: seg.pin.lat,
          lng: seg.pin.lng,
          displayName: query,
          source: 'nominatim',
          expiresAt,
        })
        .onConflictDoUpdate({
          target: geocodeCache.queryNormalized,
          set: { lat: seg.pin.lat, lng: seg.pin.lng, displayName: query, expiresAt },
        });
    }

    // 6) Documents — a boarding pass (two legs) and a hotel email,
    //    each carrying an extracted structured payload, linked to the
    //    segments they describe. Object keys point at files that don't
    //    exist on disk; the Documents tab only lists rows, it doesn't
    //    read the originals.
    const flightSegmentIds = insertedSegments.filter((s) => s.type === 'flight').map((s) => s.id);
    const hotelSegmentIds = insertedSegments.filter((s) => s.type === 'hotel').map((s) => s.id);
    // Nazuna Kyoto Gosho is the second hotel inserted.
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

    // 8) World-map choropleth — manual visited-country marks.
    await db
      .insert(userVisitedCountries)
      .values(VISITED_COUNTRIES.map((countryCode) => ({ userId, countryCode })))
      .onConflictDoNothing();

    // 9) Fresh session for the headless browser. Auth.js's default
    //    session token is an opaque random string, NOT a JWT.
    const sessionToken = `screenshot.${randomUUID()}.${randomBytes(16).toString('hex')}`;
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(sessions).values({ sessionToken, userId, expires });

    // 10) Re-read the trips so the capture script can build deep links
    //     without parsing IDs from the page.
    const persisted = await db
      .select({ id: trips.id, title: trips.title, status: trips.status })
      .from(trips)
      .where(eq(trips.userId, userId));

    process.stdout.write(
      JSON.stringify({ sessionToken, userId, detailTripId: hero.id, trips: persisted }, null, 2) +
        '\n',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
