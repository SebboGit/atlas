// Tests for getTripMapDataForUser focused on the cache resolution
// path. Flight pinning is already covered indirectly by the
// segment-row / map components — these tests pin down the Phase 3b
// wiring: hotels resolve to pins on cache hit, fall into the
// ungeocoded list on null result, and fire a background fetch on
// cache miss.
//
// Mocks at the module boundary:
//   - drizzle-orm helpers are stubs (this test never executes the
//     real query — `db` is mocked to a chain that resolves to dbRows)
//   - @/lib/geocoding's read helpers are mocked so we can drive
//     cache-hit / null / miss without touching the cache module
//   - @/lib/airports is mocked because the non-flight rows don't
//     need it; the one flight row in the multi-segment test gets a
//     known coord

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Segment } from '@/db/schema';

// Test-controlled rows the mocked `db.select(...)` chain resolves to.
const dbState = vi.hoisted(() => ({ rows: [] as Segment[] }));

vi.mock('drizzle-orm', () => ({
  // The repo passes these into Drizzle as SQL builders. The mock
  // doesn't care what shape they have — it never executes them; the
  // mocked `db` chain returns dbState.rows directly.
  and: () => ({}),
  asc: () => ({}),
  eq: () => ({}),
  getTableColumns: () => ({}),
  sql: (..._args: unknown[]) => ({}),
}));

vi.mock('@/db/schema', () => ({
  segments: { tripId: {}, startsAt: {}, createdAt: {} },
  trips: { id: {}, userId: {} },
}));

vi.mock('@/db/client', () => {
  // Chainable thenable — every chain method returns the same object,
  // and awaiting it (via `then`) resolves to the rows.
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'where']) {
    chain[m] = () => chain;
  }
  chain.orderBy = () => Promise.resolve(dbState.rows);
  chain.then = (resolve: (rows: Segment[]) => unknown, reject?: (err: unknown) => unknown) =>
    Promise.resolve(dbState.rows).then(resolve, reject);
  return { db: { select: () => chain } };
});

const geocodingMocks = vi.hoisted(() => ({
  buildGeocodeQuery: vi.fn<(s: Segment) => string | null>(),
  enqueueGeocodeFetch: vi.fn<(q: string) => void>(),
  getCachedMany: vi.fn(),
  normalizeQuery: vi.fn((s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ')),
  // Passthrough — these tests stub buildGeocodeQuery directly and
  // don't include addresses with postcodes / designators, so the
  // normalizer is a no-op for them.
  normalizeForGeocoder: vi.fn((s: string) => s),
}));

vi.mock('@/lib/geocoding', () => geocodingMocks);

const airportMocks = vi.hoisted(() => ({
  getAirportCoords: vi.fn<(iata: string) => { lat: number; lng: number } | null>(),
  getAirportCountry: vi.fn<(iata: string | null | undefined) => string | null>(),
}));

vi.mock('@/lib/airports', () => airportMocks);

import { getTripMapDataForUser } from './repo';

function makeHotel(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'seg-hotel-1',
    tripId: 'trip-1',
    type: 'hotel',
    data: { propertyName: 'Hotel California', address: '1 Sunset Blvd, Los Angeles' },
    startsAt: new Date('2026-06-01'),
    endsAt: new Date('2026-06-05'),
    locationName: null,
    countryCode: 'US',
    originCountryCode: null,
    needsReview: false,
    createdAt: new Date('2026-05-17'),
    updatedAt: new Date('2026-05-17'),
    ...overrides,
  } as Segment;
}

function makeFlight(
  id: string,
  origin: string,
  destination: string,
  overrides: Partial<Segment> = {},
): Segment {
  return {
    id,
    tripId: 'trip-1',
    type: 'flight',
    data: { originAirport: origin, destinationAirport: destination },
    startsAt: new Date('2026-06-01T10:00:00Z'),
    endsAt: null,
    locationName: null,
    countryCode: 'XX',
    originCountryCode: 'YY',
    needsReview: false,
    createdAt: new Date('2026-05-17'),
    updatedAt: new Date('2026-05-17'),
    ...overrides,
  } as Segment;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.rows = [];
  geocodingMocks.normalizeQuery.mockImplementation((s) =>
    s.toLowerCase().trim().replace(/\s+/g, ' '),
  );
});

describe('getTripMapDataForUser — non-flight cache states', () => {
  it('on cache miss: emits ungeocoded "pending" AND enqueues a background fetch', async () => {
    dbState.rows = [makeHotel()];
    geocodingMocks.buildGeocodeQuery.mockReturnValue('1 Sunset Blvd, Los Angeles');
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map([['1 sunset blvd, los angeles', { kind: 'miss' }]]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(geocodingMocks.enqueueGeocodeFetch).toHaveBeenCalledWith('1 Sunset Blvd, Los Angeles');
    expect(result.pins).toHaveLength(0);
    expect(result.ungeocoded).toHaveLength(1);
    expect(result.ungeocoded[0]!.reason).toBe('Geocoding pending — try again in a moment.');
  });

  it('chains buildGeocodeQuery → normalizeForGeocoder before cache lookup and enqueue', async () => {
    // Regression guard: if a future change drops the normalizer from
    // the read path, the cache key won't match what the lifecycle hook
    // writes and the trip map will silently lose pins. Mock the
    // normalizer as a non-identity mapper so a missed chain shows up
    // as a wrong cache key / wrong enqueue payload.
    dbState.rows = [makeHotel()];
    geocodingMocks.buildGeocodeQuery.mockReturnValue('raw addr');
    geocodingMocks.normalizeForGeocoder.mockImplementation((s) =>
      s === 'raw addr' ? 'normalized addr' : s,
    );
    // Seed the cache miss under the normalized key — only a normalized
    // lookup will find it.
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map([['normalized addr', { kind: 'miss' }]]),
    );

    await getTripMapDataForUser('user-1', 'trip-1');

    expect(geocodingMocks.normalizeForGeocoder).toHaveBeenCalledWith('raw addr');
    expect(geocodingMocks.getCachedMany).toHaveBeenCalledWith(['normalized addr']);
    expect(geocodingMocks.enqueueGeocodeFetch).toHaveBeenCalledWith('normalized addr');
  });

  it('on cache null result: emits "couldn\'t find" and does NOT enqueue', async () => {
    dbState.rows = [makeHotel()];
    geocodingMocks.buildGeocodeQuery.mockReturnValue('1 Sunset Blvd, Los Angeles');
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map([['1 sunset blvd, los angeles', { kind: 'null', displayName: null }]]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(geocodingMocks.enqueueGeocodeFetch).not.toHaveBeenCalled();
    expect(result.pins).toHaveLength(0);
    expect(result.ungeocoded).toHaveLength(1);
    expect(result.ungeocoded[0]!.reason).toBe("We couldn't find this place on the map.");
  });

  it('on cache hit: emits a hotel pin with propertyName label, compact date range, and does NOT enqueue', async () => {
    dbState.rows = [makeHotel()];
    geocodingMocks.buildGeocodeQuery.mockReturnValue('1 Sunset Blvd, Los Angeles');
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map([
        [
          '1 sunset blvd, los angeles',
          {
            kind: 'hit',
            result: { lat: 34.09, lng: -118.32, displayName: 'Sunset Blvd, Los Angeles' },
          },
        ],
      ]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(geocodingMocks.enqueueGeocodeFetch).not.toHaveBeenCalled();
    expect(result.pins).toHaveLength(1);
    const pin = result.pins[0]!;
    expect(pin.kind).toBe('hotel');
    expect(pin.label).toBe('Hotel California');
    // 1 Jun to 5 Jun — same month, compact form.
    expect(pin.dateLabel).toBe('1–5 Jun');
    expect(pin.lat).toBe(34.09);
    expect(pin.lng).toBe(-118.32);
    expect(pin.country).toBe('US');
  });

  it('formats a cross-month stay with both months spelled out', async () => {
    dbState.rows = [
      makeHotel({ startsAt: new Date('2026-05-31'), endsAt: new Date('2026-06-03') }),
    ];
    geocodingMocks.buildGeocodeQuery.mockReturnValue('1 Sunset Blvd, Los Angeles');
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map([
        [
          '1 sunset blvd, los angeles',
          {
            kind: 'hit',
            result: { lat: 34.09, lng: -118.32, displayName: 'Sunset Blvd, Los Angeles' },
          },
        ],
      ]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');
    expect(result.pins[0]!.dateLabel).toBe('31 May – 3 Jun');
  });

  it('pins both endpoints of a flight and dedups the transfer airport across legs', async () => {
    // BOS → FRA, then FRA → MUC. FRA is the destination of leg 1
    // and the origin of leg 2; it should appear as a single FRA pin,
    // not two stacked at the same coords.
    const coords: Record<string, { lat: number; lng: number }> = {
      BOS: { lat: 42.36, lng: -71.0 },
      FRA: { lat: 50.04, lng: 8.56 },
      MUC: { lat: 48.35, lng: 11.78 },
    };
    airportMocks.getAirportCoords.mockImplementation((iata) => coords[iata] ?? null);
    dbState.rows = [
      makeFlight('seg-leg-1', 'BOS', 'FRA', { countryCode: 'DE', originCountryCode: 'US' }),
      makeFlight('seg-leg-2', 'FRA', 'MUC', { countryCode: 'DE', originCountryCode: 'DE' }),
    ];
    geocodingMocks.getCachedMany.mockResolvedValue(new Map());

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    const byLabel = new Map(result.pins.map((p) => [p.label, p]));
    expect([...byLabel.keys()].sort()).toEqual(['BOS', 'FRA', 'MUC']);
    expect(byLabel.get('BOS')!.country).toBe('US');
    expect(byLabel.get('FRA')!.country).toBe('DE');
    expect(byLabel.get('MUC')!.country).toBe('DE');
    // Two arcs (one per leg) — origin-pin dedup must not collapse arcs.
    expect(result.arcs).toHaveLength(2);
  });

  it('pins both endpoints of a single-leg flight (HND and LAX)', async () => {
    // The regression that prompted the change: HND→LAX rendered an
    // arc to LAX with a LAX pin but no HND pin or label.
    const coords: Record<string, { lat: number; lng: number }> = {
      HND: { lat: 35.55, lng: 139.78 },
      LAX: { lat: 33.94, lng: -118.41 },
    };
    airportMocks.getAirportCoords.mockImplementation((iata) => coords[iata] ?? null);
    dbState.rows = [
      makeFlight('seg-1', 'HND', 'LAX', { countryCode: 'US', originCountryCode: 'JP' }),
    ];
    geocodingMocks.getCachedMany.mockResolvedValue(new Map());

    const result = await getTripMapDataForUser('user-1', 'trip-1');
    const labels = result.pins.map((p) => p.label).sort();
    expect(labels).toEqual(['HND', 'LAX']);
  });

  it('skips the origin pin when the origin IATA is unknown to the airport snapshot', async () => {
    // Origin coords lookup returning null (unknown IATA) — we still
    // pin the destination but quietly drop the origin pin AND the
    // arc. No ungeocoded entry for a missing origin: it's not the
    // primary identity of a flight.
    airportMocks.getAirportCoords.mockImplementation((iata) =>
      iata === 'LAX' ? { lat: 33.94, lng: -118.41 } : null,
    );
    dbState.rows = [
      makeFlight('seg-1', 'ZZZ', 'LAX', { countryCode: 'US', originCountryCode: null }),
    ];
    geocodingMocks.getCachedMany.mockResolvedValue(new Map());

    const result = await getTripMapDataForUser('user-1', 'trip-1');
    expect(result.pins.map((p) => p.label)).toEqual(['LAX']);
    expect(result.arcs).toHaveLength(0);
    expect(result.ungeocoded).toHaveLength(0);
  });

  it('on cache hit: a food pin headlines on the venue, not the neighbourhood locationName', async () => {
    // The bug this fix addresses: a food row carrying a
    // neighbourhood-y `locationName` ("Bukit Bintang") used to fall
    // through `nonFlightLabel`, which favours `locationName` — so the
    // pin showed the district instead of the restaurant. The venue
    // is the recognisable headline, exactly like a hotel's property
    // name.
    dbState.rows = [
      makeHotel({
        id: 'seg-food-1',
        type: 'food',
        data: { venue: 'Jalan Alor Night Market' },
        locationName: 'Bukit Bintang',
        startsAt: new Date('2026-06-02'),
        endsAt: null,
      }),
    ];
    geocodingMocks.buildGeocodeQuery.mockReturnValue('Jalan Alor Night Market');
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map([
        [
          'jalan alor night market',
          {
            kind: 'hit',
            result: { lat: 3.146, lng: 101.71, displayName: 'Jalan Alor, Kuala Lumpur' },
          },
        ],
      ]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(result.pins).toHaveLength(1);
    const pin = result.pins[0]!;
    expect(pin.kind).toBe('food');
    expect(pin.label).toBe('Jalan Alor Night Market');
    // Hover-only treatment — no always-on date label for food.
    expect(pin.dateLabel).toBeUndefined();
  });

  it('an ungeocoded food segment is labelled by its venue, not its locationName', async () => {
    // The "not pinned" list must recognise food by the same venue
    // headline the pin uses. A null cache result drops the row into
    // ungeocoded — its label should still be the venue.
    dbState.rows = [
      makeHotel({
        id: 'seg-food-2',
        type: 'food',
        data: { venue: 'Jalan Alor Night Market' },
        locationName: 'Bukit Bintang',
        startsAt: new Date('2026-06-02'),
        endsAt: null,
      }),
    ];
    geocodingMocks.buildGeocodeQuery.mockReturnValue('Jalan Alor Night Market');
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map([['jalan alor night market', { kind: 'null', displayName: null }]]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(result.pins).toHaveLength(0);
    expect(result.ungeocoded).toHaveLength(1);
    expect(result.ungeocoded[0]!.label).toBe('Jalan Alor Night Market');
  });

  it('does NOT enqueue when buildGeocodeQuery returns null (e.g. transit with no station name)', async () => {
    // A transit segment with neither toName nor fromName produces a
    // null query, so the row goes straight to ungeocoded with the
    // "add a stop name" copy — no cache lookup, no enqueue.
    dbState.rows = [
      makeHotel({
        id: 'seg-transit-1',
        type: 'transit',
        data: { mode: 'bus' },
        locationName: null,
      }),
    ];
    geocodingMocks.buildGeocodeQuery.mockReturnValue(null);
    geocodingMocks.getCachedMany.mockResolvedValue(new Map());

    const result = await getTripMapDataForUser('user-1', 'trip-1');
    expect(geocodingMocks.enqueueGeocodeFetch).not.toHaveBeenCalled();
    expect(result.ungeocoded[0]!.reason).toContain('stop name');
  });
});
