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
  // `or` backs tripVisibleToViewer (imported by the repo via tripsScope);
  // the mock never executes it, so an identity placeholder is enough.
  or: () => ({}),
  getTableColumns: () => ({}),
  sql: (..._args: unknown[]) => ({}),
}));

vi.mock('@/db/schema', () => ({
  segments: { tripId: {}, type: {}, data: {} },
  trips: { id: {}, userId: {}, title: {}, startDate: {}, endDate: {}, visibility: {} },
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

// The viewer's manual world-map marks (#87). The stats repo reads these
// through @/lib/countries/repo; mocking that boundary lets a test control
// the codes without standing up the userVisitedCountries query path.
const manualState = vi.hoisted(() => ({ codes: [] as string[] }));
vi.mock('@/lib/countries/repo', () => ({
  listManualVisitedCountriesForUser: vi.fn(async () => manualState.codes),
}));

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
  manualState.codes = [];
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

  it('runs the buildGeocodeQuery result through normalizeForGeocoder before the cache lookup', async () => {
    // Regression guard: if the stats path drops the normalize step,
    // the cache key won't match what the lifecycle hook writes and
    // the records map silently loses points. A non-identity mock
    // turns a missed chain into a test failure rather than a silent
    // cache miss.
    dbState.trips = [trip({ id: 't1', startDate: new Date('2024-01-01T00:00:00Z') })];
    dbState.segments = [
      hotel({
        id: 'h1',
        locationName: 'Queenstown',
        data: { propertyName: 'Lakeside Lodge', address: 'raw addr' },
      }),
    ];
    geocodingMocks.normalizeForGeocoder.mockImplementation((s) =>
      s === 'raw addr' ? 'normalized addr' : s,
    );
    seedGeocode('normalized addr', -45.03, 168.66);

    const data = await getStatsDashboardData('u1');

    expect(geocodingMocks.normalizeForGeocoder).toHaveBeenCalledWith('raw addr');
    expect(geocodingMocks.getCachedMany).toHaveBeenCalledWith(['normalized addr']);
    // A cache miss under the raw key would produce no southernmost
    // record; the cache hit under the normalized key surfaces the
    // hotel as the southernmost point.
    expect(data.records.southernmost?.label).toBe('Queenstown');
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

describe('getStatsDashboardData — only counts what has happened', () => {
  // Fixed clock: the boundary is the start-of-day-UTC convention the
  // auto-status job uses, so "now" being midday must behave like the
  // day boundary, not the instant.
  const NOW = new Date('2026-06-10T12:00:00Z');

  it('excludes an upcoming trip and its segments from every tally', async () => {
    dbState.trips = [
      trip({
        id: 'done',
        title: 'Done',
        startDate: new Date('2024-05-01T00:00:00Z'),
        endDate: new Date('2024-05-05T00:00:00Z'),
      }),
      // Booked, starts in three months — must not count anywhere.
      trip({
        id: 'booked',
        title: 'Booked',
        startDate: new Date('2026-09-01T00:00:00Z'),
        endDate: new Date('2026-09-30T00:00:00Z'),
      }),
    ];
    dbState.segments = [
      hotel({
        id: 'h1',
        tripId: 'done',
        countryCode: 'JP',
        startsAt: new Date('2024-05-01T00:00:00Z'),
        endsAt: new Date('2024-05-05T00:00:00Z'),
      }),
      flight({
        id: 'f1',
        tripId: 'done',
        startsAt: new Date('2024-05-01T08:00:00Z'),
        data: { originAirport: 'LHR', destinationAirport: 'CDG', carrier: 'British Airways' },
      }),
      hotel({
        id: 'h2',
        tripId: 'booked',
        countryCode: 'AU',
        startsAt: new Date('2026-09-01T00:00:00Z'),
        endsAt: new Date('2026-09-30T00:00:00Z'),
        locationName: 'Sydney',
        data: { propertyName: 'Harbour Hotel', address: '1 George St, Sydney' },
      }),
      // Two future Qantas legs: were they counted, Qantas would beat
      // British Airways and SYD's latitude would win southernmost.
      flight({
        id: 'f2',
        tripId: 'booked',
        startsAt: new Date('2026-09-01T08:00:00Z'),
        data: { originAirport: 'LHR', destinationAirport: 'SYD', carrier: 'Qantas' },
      }),
      flight({
        id: 'f3',
        tripId: 'booked',
        startsAt: new Date('2026-09-02T08:00:00Z'),
        data: { originAirport: 'SYD', destinationAirport: 'MEL', carrier: 'Qantas' },
      }),
    ];
    // Even a cached geocode for the future hotel must not contribute.
    seedGeocode('1 George St, Sydney', -33.87, 151.21);

    const data = await getStatsDashboardData('u1', NOW);

    expect(data.isEmpty).toBe(false);
    expect(data.lifetime.countriesVisited).toBe(1);
    expect(data.lifetime.newestCountry?.code).toBe('JP');
    expect(data.lifetime.nightsAway).toBe(4);
    expect(data.lifetime.flightsTaken).toBe(1);
    // LHR→CDG only (~348 km); LHR→SYD would add ~17 000 km, and a
    // broken airport lookup would read 0 — bound it from both sides.
    expect(data.lifetime.distanceFlownKm).toBeGreaterThan(300);
    expect(data.lifetime.distanceFlownKm).toBeLessThan(1000);
    expect(data.yearOverYear.tripsPerYear).toEqual([{ year: 2024, count: 1 }]);
    expect(data.yearOverYear.nightsPerYear).toEqual([{ year: 2024, count: 4 }]);
    expect(data.yearOverYear.newCountriesPerYear).toEqual([{ year: 2024, count: 1 }]);
    // The 29-night booked trip must not take the record from the 4-night one.
    expect(data.records.longestTrip?.tripId).toBe('done');
    expect(data.records.topAirline?.name).toBe('British Airways');
    expect(data.records.southernmost?.label).toBe('CDG');
  });

  it('reports isEmpty when every trip is still upcoming', async () => {
    dbState.trips = [
      trip({
        id: 't1',
        startDate: new Date('2026-12-01T00:00:00Z'),
        endDate: new Date('2026-12-10T00:00:00Z'),
      }),
    ];
    dbState.segments = [
      flight({
        id: 'f1',
        startsAt: new Date('2026-12-01T08:00:00Z'),
        data: { originAirport: 'LHR', destinationAirport: 'CDG' },
      }),
    ];
    const data = await getStatsDashboardData('u1', NOW);
    expect(data.isEmpty).toBe(true);
    expect(data.lifetime.flightsTaken).toBe(0);
    expect(data.yearOverYear.tripsPerYear).toEqual([]);
  });

  it('counts only the nights already slept on an in-progress hotel stay', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2026-06-05T00:00:00Z') })];
    dbState.segments = [
      hotel({
        id: 'h1',
        startsAt: new Date('2026-06-08T15:00:00Z'),
        endsAt: new Date('2026-06-14T11:00:00Z'),
      }),
    ];
    const data = await getStatsDashboardData('u1', NOW);
    // Checked in June 8, now June 10 → two nights slept, four ahead.
    expect(data.lifetime.nightsAway).toBe(2);
    expect(data.yearOverYear.nightsPerYear).toEqual([{ year: 2026, count: 2 }]);
  });

  it('counts zero nights for a stay checking in today', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2026-06-10T00:00:00Z') })];
    dbState.segments = [
      // Tonight hasn't been slept yet.
      hotel({
        id: 'h1',
        startsAt: new Date('2026-06-10T15:00:00Z'),
        endsAt: new Date('2026-06-14T11:00:00Z'),
      }),
    ];
    const data = await getStatsDashboardData('u1', NOW);
    expect(data.lifetime.nightsAway).toBe(0);
    expect(data.yearOverYear.nightsPerYear).toEqual([]);
  });

  it('counts a flight dated today but not one dated tomorrow', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2026-06-08T00:00:00Z') })];
    dbState.segments = [
      // Tonight's flight — today counts, even before its wall-clock.
      flight({
        id: 'f1',
        startsAt: new Date('2026-06-10T23:00:00Z'),
        data: { originAirport: 'LHR', destinationAirport: 'CDG' },
      }),
      flight({
        id: 'f2',
        startsAt: new Date('2026-06-11T09:00:00Z'),
        data: { originAirport: 'CDG', destinationAirport: 'LHR' },
      }),
    ];
    const data = await getStatsDashboardData('u1', NOW);
    expect(data.lifetime.flightsTaken).toBe(1);
  });

  it('falls back to the trip start date for undated segments', async () => {
    dbState.trips = [
      trip({ id: 'past', startDate: new Date('2024-05-01T00:00:00Z') }),
      trip({ id: 'future', startDate: new Date('2026-09-01T00:00:00Z') }),
      // Undated wishlist draft (ADR-0003) — nothing on it has happened.
      trip({ id: 'draft' }),
    ];
    dbState.segments = [
      flight({
        id: 'f1',
        tripId: 'past',
        data: { originAirport: 'LHR', destinationAirport: 'CDG' },
      }),
      flight({
        id: 'f2',
        tripId: 'future',
        data: { originAirport: 'LHR', destinationAirport: 'SIN' },
      }),
      flight({
        id: 'f3',
        tripId: 'draft',
        data: { originAirport: 'LHR', destinationAirport: 'JFK' },
      }),
    ];
    const data = await getStatsDashboardData('u1', NOW);
    expect(data.lifetime.flightsTaken).toBe(1);
  });

  it('counts an in-progress trip toward longest-trip with the nights elapsed so far', async () => {
    dbState.trips = [
      trip({
        id: 'done',
        title: 'Done',
        startDate: new Date('2024-05-01T00:00:00Z'),
        endDate: new Date('2024-05-04T00:00:00Z'),
      }),
      // Five nights elapsed of 20 booked — competes with the 5, not the 20.
      trip({
        id: 'going',
        title: 'Going',
        startDate: new Date('2026-06-05T00:00:00Z'),
        endDate: new Date('2026-06-25T00:00:00Z'),
      }),
    ];
    const data = await getStatsDashboardData('u1', NOW);
    expect(data.records.longestTrip).toEqual({ tripId: 'going', title: 'Going', nights: 5 });
  });
});

describe('getStatsDashboardData — manual world-map countries (#87)', () => {
  it('counts a manually-marked country with no trips, and shows the dashboard', async () => {
    // Painted two countries on the map, logged nothing else.
    manualState.codes = ['BR', 'AR'];
    const data = await getStatsDashboardData('u1');
    expect(data.isEmpty).toBe(false);
    expect(data.lifetime.countriesVisited).toBe(2);
    // Dateless marks can't be "newest" and can't paint a year strip.
    expect(data.lifetime.newestCountry).toBeNull();
    expect(data.yearOverYear.newCountriesPerYear).toEqual([]);
    expect(data.lifetime.flightsTaken).toBe(0);
  });

  it('unions manual marks with trip-derived countries, counting overlaps once', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2024-03-01T00:00:00Z') })];
    dbState.segments = [
      hotel({
        id: 'h1',
        countryCode: 'JP',
        startsAt: new Date('2024-03-01T00:00:00Z'),
        endsAt: new Date('2024-03-04T00:00:00Z'),
      }),
    ];
    // JP also appears trip-derived; FR and IT are manual-only.
    manualState.codes = ['JP', 'FR', 'IT'];
    const data = await getStatsDashboardData('u1', new Date('2024-06-01T00:00:00Z'));
    expect(data.lifetime.countriesVisited).toBe(3); // JP ∪ {JP, FR, IT}
    // Newest country stays trip-derived — the manual marks supply no date.
    expect(data.lifetime.newestCountry?.code).toBe('JP');
  });

  it('shows the dashboard when the only trip is upcoming but a country is marked', async () => {
    // No started trip and no past segment — the past-only gate (#85)
    // would call this empty — but a manual mark is "I've been here," so
    // it lifts isEmpty and supplies the count on its own.
    dbState.trips = [
      trip({
        id: 't1',
        startDate: new Date('2026-12-01T00:00:00Z'),
        endDate: new Date('2026-12-10T00:00:00Z'),
      }),
    ];
    dbState.segments = [
      flight({
        id: 'f1',
        startsAt: new Date('2026-12-01T08:00:00Z'),
        data: { originAirport: 'LHR', destinationAirport: 'CDG' },
      }),
    ];
    manualState.codes = ['PT'];
    const data = await getStatsDashboardData('u1', new Date('2026-06-10T12:00:00Z'));
    expect(data.isEmpty).toBe(false);
    expect(data.lifetime.countriesVisited).toBe(1);
    expect(data.lifetime.flightsTaken).toBe(0); // the future flight stays excluded
  });

  it('keeps manual marks out of the per-year new-countries strip', async () => {
    dbState.trips = [trip({ id: 't1', startDate: new Date('2024-03-01T00:00:00Z') })];
    dbState.segments = [
      hotel({
        id: 'h1',
        countryCode: 'JP',
        startsAt: new Date('2024-03-01T00:00:00Z'),
        endsAt: new Date('2024-03-04T00:00:00Z'),
      }),
    ];
    manualState.codes = ['FR'];
    const data = await getStatsDashboardData('u1', new Date('2024-06-01T00:00:00Z'));
    // Only JP's dated first visit reaches the strip; FR adds to the count only.
    expect(data.yearOverYear.newCountriesPerYear).toEqual([{ year: 2024, count: 1 }]);
    expect(data.lifetime.countriesVisited).toBe(2);
  });
});
