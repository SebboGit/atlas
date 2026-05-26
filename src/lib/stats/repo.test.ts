// Tests for getStatsDashboardData — exercising the in-memory
// aggregation (lifetime headline, year-over-year strips, personal
// records) over controlled query rows.
//
// Mocks at the module boundary, mirroring src/lib/trip-map/repo.test.ts:
//   - drizzle-orm helpers are inert stubs (the real query never runs)
//   - @/db/schema tables are placeholder objects
//   - @/db/client's `db` is a chain that resolves to test-controlled
//     rows; the two parallel SELECTs are dealt out in call order
//   - @/lib/geocoding's read helpers are mocked so non-flight extremes
//     are driven through the real cache-resolution path (build query →
//     batch cache read → keep hits) without touching the geocode cache
//
// @/lib/airports is NOT mocked — the committed IATA snapshot is real
// reference data, so distance and flight-derived extremes are checked
// against actual coordinates.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CachedLookup } from '@/lib/geocoding';

import type { Segment, Trip } from '@/db/schema';

// Test-controlled rows. The repo issues two SELECTs in a fixed order
// (trips, segments); the mocked `db` deals them out by index.
const dbState = vi.hoisted(() => ({
  trips: [] as unknown[],
  segments: [] as unknown[],
  call: 0,
}));

vi.mock('drizzle-orm', () => ({
  eq: () => ({}),
  getTableColumns: () => ({}),
  sql: (..._args: unknown[]) => ({}),
}));

vi.mock('@/db/schema', () => ({
  segments: { tripId: {}, type: {}, data: {} },
  trips: { id: {}, userId: {}, title: {}, startDate: {}, endDate: {} },
}));

vi.mock('@/db/client', () => {
  // Each `db.select(...)` opens a fresh chain; `.where()` is the
  // terminal that resolves to the next batch of rows in deal order.
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    const ret = () => chain;
    chain.from = ret;
    chain.innerJoin = ret;
    chain.where = () => {
      const idx = dbState.call;
      dbState.call += 1;
      const batch = idx === 0 ? dbState.trips : dbState.segments;
      return Promise.resolve(batch);
    };
    return chain;
  };
  return { db: { select: () => makeChain() } };
});

// Geocode-cache state, keyed by normalized query. resolveNonFlightPoints
// runs the real buildGeocodeQuery → getCachedMany → keep-hits path; the
// mocked getCachedMany resolves against this map so a test can seed a
// hit, a null, or leave a query as a miss.
const geoState = vi.hoisted(() => ({ cache: new Map<string, CachedLookup>() }));

const geocodingMocks = vi.hoisted(() => ({
  // Mirrors the real per-type derivation closely enough for the tests:
  // hotels geocode by address (fallback propertyName), activities by
  // title (+ locationName), transit by destination name. Flights and
  // notes produce no query. Anything else is null.
  buildGeocodeQuery: vi.fn((seg: Segment): string | null => {
    const data = (seg.data ?? {}) as Record<string, unknown>;
    if (seg.type === 'hotel') {
      const address = typeof data.address === 'string' ? data.address.trim() : '';
      if (address) return address;
      return typeof data.propertyName === 'string' ? data.propertyName : null;
    }
    if (seg.type === 'activity') {
      const title = typeof data.title === 'string' ? data.title : null;
      if (!title) return null;
      const loc = seg.locationName?.trim();
      return loc ? `${title}, ${loc}` : title;
    }
    if (seg.type === 'transit') {
      const dest = typeof data.toName === 'string' ? data.toName.trim() : '';
      if (dest) return dest;
      const origin = typeof data.fromName === 'string' ? data.fromName.trim() : '';
      return origin || null;
    }
    return null;
  }),
  normalizeQuery: vi.fn((s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ')),
  // Passthrough — fixture queries are clean (no postcode / designator
  // shape) so the normalizer is a no-op for these tests. The real
  // normalizer has its own dedicated unit tests.
  normalizeForGeocoder: vi.fn((s: string) => s),
  getCachedMany: vi.fn(async (queries: ReadonlyArray<string>) => {
    const out = new Map<string, CachedLookup>();
    for (const q of queries) {
      const key = q.toLowerCase().trim().replace(/\s+/g, ' ');
      out.set(key, geoState.cache.get(key) ?? { kind: 'miss' });
    }
    return out;
  }),
}));

vi.mock('@/lib/geocoding', () => geocodingMocks);

// Seed a positive cache hit for `query` at the given coordinates.
function seedGeocode(query: string, lat: number, lng: number) {
  const key = query.toLowerCase().trim().replace(/\s+/g, ' ');
  geoState.cache.set(key, {
    kind: 'hit',
    result: { lat, lng, displayName: query },
  });
}

// Import after the mocks are registered.
const { getStatsDashboardData } = await import('./repo');

// ─── Row builders ────────────────────────────────────────────────────

function trip(over: Partial<Trip>): Trip {
  return {
    id: 't1',
    userId: 'u1',
    title: 'Trip',
    summary: null,
    status: 'completed',
    startDate: null,
    endDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    searchText: null,
    searchTsv: null,
    ...over,
  } as Trip;
}

function flight(over: Partial<Segment> & { data?: unknown }): Segment {
  return {
    id: 's1',
    tripId: 't1',
    type: 'flight',
    data: {},
    startsAt: null,
    endsAt: null,
    locationName: null,
    countryCode: null,
    originCountryCode: null,
    needsReview: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    searchText: null,
    searchTsv: null,
    ...over,
  } as Segment;
}

function hotel(over: Partial<Segment>): Segment {
  return flight({ type: 'hotel', ...over });
}

function activity(over: Partial<Segment>): Segment {
  return flight({ type: 'activity', ...over });
}

beforeEach(() => {
  dbState.trips = [];
  dbState.segments = [];
  dbState.call = 0;
  geoState.cache.clear();
});

// ─── Tests ───────────────────────────────────────────────────────────

describe('getStatsDashboardData — empty', () => {
  it('reports isEmpty and zeroed lifetime stats when there are no trips', async () => {
    const data = await getStatsDashboardData('u1');
    expect(data.isEmpty).toBe(true);
    expect(data.lifetime.countriesVisited).toBe(0);
    expect(data.lifetime.flightsTaken).toBe(0);
    expect(data.lifetime.distanceFlownKm).toBe(0);
    expect(data.lifetime.newestCountry).toBeNull();
    expect(data.records.longestTrip).toBeNull();
    expect(data.records.northernmost).toBeNull();
  });
});

describe('getStatsDashboardData — lifetime headline', () => {
  it('counts countries from non-flight segments only, picks newest by first visit', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2024-01-01T00:00:00Z') })];
    dbState.segments = [
      hotel({ id: 'h1', countryCode: 'JP', startsAt: new Date('2024-03-01T00:00:00Z') }),
      activity({ id: 'a1', countryCode: 'VN', startsAt: new Date('2025-03-01T00:00:00Z') }),
      // A flight into Thailand must NOT paint TH as visited.
      flight({ id: 'f1', countryCode: 'TH', startsAt: new Date('2025-06-01T00:00:00Z') }),
    ];
    const data = await getStatsDashboardData('u1');
    expect(data.lifetime.countriesVisited).toBe(2);
    expect(data.lifetime.newestCountry?.code).toBe('VN');
  });

  it('sums hotel nights and ignores activities/transit for nightsAway', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2024-01-01T00:00:00Z') })];
    dbState.segments = [
      hotel({
        id: 'h1',
        startsAt: new Date('2024-03-01T00:00:00Z'),
        endsAt: new Date('2024-03-05T00:00:00Z'),
      }),
      activity({
        id: 'a1',
        startsAt: new Date('2024-03-02T00:00:00Z'),
        endsAt: new Date('2024-03-09T00:00:00Z'),
      }),
    ];
    const data = await getStatsDashboardData('u1');
    expect(data.lifetime.nightsAway).toBe(4);
  });

  it('counts flights and sums great-circle distance from the airport snapshot', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2024-01-01T00:00:00Z') })];
    dbState.segments = [
      flight({
        id: 'f1',
        data: { originAirport: 'LHR', destinationAirport: 'CDG' },
      }),
      flight({
        id: 'f2',
        data: { originAirport: 'LHR', destinationAirport: 'SIN' },
      }),
    ];
    const data = await getStatsDashboardData('u1');
    expect(data.lifetime.flightsTaken).toBe(2);
    // LHR→CDG (~348 km) + LHR→SIN (~10 880 km) ≈ 11 200 km.
    expect(data.lifetime.distanceFlownKm).toBeGreaterThan(11000);
    expect(data.lifetime.distanceFlownKm).toBeLessThan(11400);
  });
});

describe('getStatsDashboardData — year-over-year', () => {
  it('tallies trips, nights, and new countries by year', async () => {
    dbState.trips = [
      trip({ id: 't1', startDate: new Date('2023-05-01T00:00:00Z') }),
      trip({ id: 't2', startDate: new Date('2024-05-01T00:00:00Z') }),
      trip({ id: 't3', startDate: new Date('2024-09-01T00:00:00Z') }),
    ];
    dbState.segments = [
      hotel({
        id: 'h1',
        startsAt: new Date('2023-05-02T00:00:00Z'),
        endsAt: new Date('2023-05-05T00:00:00Z'),
        countryCode: 'JP',
      }),
      hotel({
        id: 'h2',
        startsAt: new Date('2024-05-02T00:00:00Z'),
        endsAt: new Date('2024-05-04T00:00:00Z'),
        countryCode: 'VN',
      }),
    ];
    const data = await getStatsDashboardData('u1');
    expect(data.yearOverYear.tripsPerYear).toEqual([
      { year: 2023, count: 1 },
      { year: 2024, count: 2 },
    ]);
    expect(data.yearOverYear.nightsPerYear).toEqual([
      { year: 2023, count: 3 },
      { year: 2024, count: 2 },
    ]);
    expect(data.yearOverYear.newCountriesPerYear).toEqual([
      { year: 2023, count: 1 },
      { year: 2024, count: 1 },
    ]);
  });
});

describe('getStatsDashboardData — personal records', () => {
  it('finds the longest dated trip', async () => {
    dbState.trips = [
      trip({
        id: 't1',
        title: 'Weekend',
        startDate: new Date('2024-05-01T00:00:00Z'),
        endDate: new Date('2024-05-03T00:00:00Z'),
      }),
      trip({
        id: 't2',
        title: 'Grand tour',
        startDate: new Date('2024-08-01T00:00:00Z'),
        endDate: new Date('2024-08-20T00:00:00Z'),
      }),
    ];
    const data = await getStatsDashboardData('u1');
    expect(data.records.longestTrip).toEqual({
      tripId: 't2',
      title: 'Grand tour',
      nights: 19,
    });
  });

  it('derives north/south extremes from airports and cached non-flight points', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2024-01-01T00:00:00Z') })];
    dbState.segments = [
      flight({ id: 'f1', data: { originAirport: 'LHR', destinationAirport: 'SIN' } }),
      // A hotel whose address resolves (via the geocode cache) to a
      // far-south point that should win southernmost.
      hotel({
        id: 'h1',
        locationName: 'Queenstown',
        data: { propertyName: 'Lakeside Lodge', address: '1 Lake St, Queenstown, NZ' },
      }),
    ];
    // Seed the cache hit for the hotel's address-derived query.
    seedGeocode('1 Lake St, Queenstown, NZ', -45.03, 168.66);
    const data = await getStatsDashboardData('u1');
    expect(data.records.northernmost?.label).toBe('LHR');
    expect(data.records.southernmost?.label).toBe('Queenstown');
    expect(data.records.southernmost!.lat).toBeLessThan(0);
  });

  it('skips non-flight segments with no cached geocode (no live geocoding)', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2024-01-01T00:00:00Z') })];
    dbState.segments = [
      flight({ id: 'f1', data: { originAirport: 'LHR', destinationAirport: 'CDG' } }),
      // Hotel with a geocodable address but no cache entry — a miss
      // must not contribute a point and must not trigger a fetch.
      hotel({
        id: 'h1',
        locationName: 'Nowhere',
        data: { propertyName: 'Uncached Inn', address: '99 Unknown Rd' },
      }),
    ];
    const data = await getStatsDashboardData('u1');
    // Extremes fall back to the flight airports only.
    expect(data.records.northernmost?.label).toBe('LHR');
    expect(data.records.southernmost?.label).toBe('CDG');
  });

  it('picks the most-visited airport and the top airline', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2024-01-01T00:00:00Z') })];
    dbState.segments = [
      flight({
        id: 'f1',
        data: { originAirport: 'LHR', destinationAirport: 'CDG', carrier: 'British Airways' },
      }),
      flight({
        id: 'f2',
        data: { originAirport: 'CDG', destinationAirport: 'LHR', carrier: 'British Airways' },
      }),
      flight({
        id: 'f3',
        data: { originAirport: 'LHR', destinationAirport: 'JFK', carrier: 'Air France' },
      }),
    ];
    const data = await getStatsDashboardData('u1');
    // LHR appears on all three legs (f1 origin, f2 dest, f3 origin).
    expect(data.records.mostVisitedAirport).toEqual({ code: 'LHR', visits: 3 });
    expect(data.records.topAirline).toEqual({ name: 'British Airways', flights: 2 });
  });

  it('resolves a bare IATA carrier code to the full airline name', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2024-01-01T00:00:00Z') })];
    dbState.segments = [
      // Legacy row storing the raw IATA designator "BA".
      flight({
        id: 'f1',
        data: { originAirport: 'LHR', destinationAirport: 'CDG', carrier: 'BA' },
      }),
    ];
    const data = await getStatsDashboardData('u1');
    expect(data.records.topAirline).toEqual({ name: 'British Airways', flights: 1 });
  });

  it('tallies an IATA-coded leg and a name-coded leg as one airline', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2024-01-01T00:00:00Z') })];
    dbState.segments = [
      // Same carrier, two storage forms — must collapse into one tally.
      flight({
        id: 'f1',
        data: { originAirport: 'LHR', destinationAirport: 'CDG', carrier: 'BA' },
      }),
      flight({
        id: 'f2',
        data: { originAirport: 'CDG', destinationAirport: 'LHR', carrier: 'British Airways' },
      }),
    ];
    const data = await getStatsDashboardData('u1');
    expect(data.records.topAirline).toEqual({ name: 'British Airways', flights: 2 });
  });
});
