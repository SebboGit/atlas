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
  // `or` backs tripVisibleToViewer, imported by the repo for the trip
  // access gate. Identity placeholder — the mock never executes it.
  or: () => ({}),
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
  getGeocodeWorkerStatus: vi.fn<() => Promise<'ok' | 'unconfigured' | 'worker-down'>>(),
  normalizeQuery: vi.fn((s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ')),
  // Passthrough — these tests stub buildGeocodeQuery directly and
  // don't include addresses with postcodes / designators, so the
  // normalizer is a no-op for them.
  normalizeForGeocoder: vi.fn((s: string) => s),
}));

// The transit endpoint builders and Plus Code helpers stay real: the
// repo's per-endpoint branch is only meaningful against the actual
// station keys (ADR-0019).
vi.mock('@/lib/geocoding', async () => {
  const segmentQuery = await vi.importActual<typeof import('@/lib/geocoding/segment-query')>(
    '@/lib/geocoding/segment-query',
  );
  const plusCode = await vi.importActual<typeof import('@/lib/geocoding/plus-code')>(
    '@/lib/geocoding/plus-code',
  );
  return {
    ...geocodingMocks,
    buildTransitEndpointQueries: segmentQuery.buildTransitEndpointQueries,
    decodePlusCode: plusCode.decodePlusCode,
    tryParsePlusCode: plusCode.tryParsePlusCode,
  };
});

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
  // Healthy worker by default; the banner-specific tests override.
  geocodingMocks.getGeocodeWorkerStatus.mockResolvedValue('ok');
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
    // A pending miss probes worker health; healthy by default.
    expect(geocodingMocks.getGeocodeWorkerStatus).toHaveBeenCalledTimes(1);
    expect(result.geocodeWorkerStatus).toBe('ok');
  });

  it('surfaces a worker-down status when a pending miss meets an unhealthy worker', async () => {
    dbState.rows = [makeHotel()];
    geocodingMocks.buildGeocodeQuery.mockReturnValue('1 Sunset Blvd, Los Angeles');
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map([['1 sunset blvd, los angeles', { kind: 'miss' }]]),
    );
    geocodingMocks.getGeocodeWorkerStatus.mockResolvedValue('worker-down');

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(result.geocodeWorkerStatus).toBe('worker-down');
  });

  it('uses buildGeocodeQuery output verbatim for cache lookup and enqueue (geocoder-ready, ADR-0018)', async () => {
    // Regression guard: buildGeocodeQuery output is already
    // geocoder-normalized. Re-applying normalizeForGeocoder on the
    // read path would strip tokens from name-first queries ("Room 39,
    // Bangkok" → "Bangkok") and fork the cache key away from what the
    // lifecycle hook writes — the trip map would silently lose pins.
    dbState.rows = [makeHotel()];
    geocodingMocks.buildGeocodeQuery.mockReturnValue('Room 39, Bangkok');
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map([['Room 39, Bangkok', { kind: 'miss' }]]),
    );

    await getTripMapDataForUser('user-1', 'trip-1');

    expect(geocodingMocks.normalizeForGeocoder).not.toHaveBeenCalled();
    expect(geocodingMocks.getCachedMany).toHaveBeenCalledWith(['Room 39, Bangkok']);
    expect(geocodingMocks.enqueueGeocodeFetch).toHaveBeenCalledWith('Room 39, Bangkok');
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
    // No pending miss → no worker-health probe, status stays 'ok'.
    expect(geocodingMocks.getGeocodeWorkerStatus).not.toHaveBeenCalled();
    expect(result.geocodeWorkerStatus).toBe('ok');
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
    expect(result.arcs.every((a) => a.kind === 'flight')).toBe(true);
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

describe('getTripMapDataForUser — train, bus and ferry routes (ADR-0019)', () => {
  const TOKYO = { lat: 35.6812, lng: 139.7671 };
  const KYOTO = { lat: 34.9858, lng: 135.7588 };
  const TOKYO_KEY = 'station:train:jp:tokyo station';
  const KYOTO_KEY = 'station:train:jp:kyoto station';

  function makeTransit(
    id: string,
    data: Record<string, unknown>,
    overrides: Partial<Segment> = {},
  ) {
    return makeHotel({
      id,
      type: 'transit',
      data: { mode: 'train', ...data },
      locationName: 'Tokyo → Kyoto',
      countryCode: 'JP',
      startsAt: new Date('2025-10-07T09:12:00Z'),
      endsAt: new Date('2025-10-07T11:30:00Z'),
      ...overrides,
    });
  }
  const hit = (p: { lat: number; lng: number }) => ({
    kind: 'hit',
    result: { ...p, displayName: 'x' },
    cityPending: false,
  });
  const SHINKANSEN = { fromName: 'Tokyo Station', toName: 'Kyoto Station', carrier: 'JR Central' };

  it('pins both stations and draws a transit arc between them', async () => {
    dbState.rows = [makeTransit('seg-train', SHINKANSEN)];
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map<string, object>([
        [TOKYO_KEY, hit(TOKYO)],
        [KYOTO_KEY, hit(KYOTO)],
      ]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(geocodingMocks.getCachedMany).toHaveBeenCalledOnce();
    expect(geocodingMocks.getCachedMany.mock.calls[0]![0]).toEqual([
      'station:train:jp:Tokyo Station',
      'station:train:jp:Kyoto Station',
    ]);
    expect(result.pins).toEqual([
      {
        segmentId: 'seg-train',
        kind: 'transit',
        endpoint: 'origin',
        label: 'Tokyo Station',
        sublabel: 'JR Central',
        country: 'JP',
        ...TOKYO,
        date: new Date('2025-10-07T09:12:00Z'),
      },
      {
        segmentId: 'seg-train',
        kind: 'transit',
        endpoint: 'destination',
        label: 'Kyoto Station',
        sublabel: 'JR Central',
        country: 'JP',
        ...KYOTO,
        date: new Date('2025-10-07T11:30:00Z'),
      },
    ]);
    expect(result.arcs).toEqual([
      {
        segmentId: 'seg-train',
        kind: 'transit',
        mode: 'train',
        originLat: TOKYO.lat,
        originLng: TOKYO.lng,
        destLat: KYOTO.lat,
        destLng: KYOTO.lng,
        originCountry: 'JP',
        destCountry: 'JP',
      },
    ]);
    expect(result.ungeocoded).toEqual([]);
    expect(geocodingMocks.enqueueGeocodeFetch).not.toHaveBeenCalled();
  });

  it('keeps the found station and names the missing one when an end has no match', async () => {
    dbState.rows = [makeTransit('seg-train', SHINKANSEN)];
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map<string, object>([
        [TOKYO_KEY, { kind: 'null' }],
        [KYOTO_KEY, hit(KYOTO)],
      ]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(result.pins.map((p) => p.endpoint)).toEqual(['destination']);
    expect(result.arcs).toEqual([]);
    expect(result.ungeocoded).toEqual([
      {
        segmentId: 'seg-train',
        type: 'transit',
        label: 'Tokyo Station → Kyoto Station',
        reason: "We couldn't find the departure point on the map.",
      },
    ]);
  });

  it('enqueues only the missing end and reports one pending entry', async () => {
    dbState.rows = [makeTransit('seg-train', SHINKANSEN)];
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map<string, object>([
        [TOKYO_KEY, { kind: 'miss' }],
        [KYOTO_KEY, hit(KYOTO)],
      ]),
    );
    geocodingMocks.getGeocodeWorkerStatus.mockResolvedValue('worker-down');

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(geocodingMocks.enqueueGeocodeFetch).toHaveBeenCalledExactlyOnceWith(
      'station:train:jp:Tokyo Station',
    );
    expect(result.ungeocoded).toHaveLength(1);
    expect(result.ungeocoded[0]!.reason).toMatch(/pending/i);
    expect(result.geocodeWorkerStatus).toBe('worker-down');
  });

  it('lists a leg once with the generic reason when neither station is found', async () => {
    dbState.rows = [makeTransit('seg-train', SHINKANSEN)];
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map<string, object>([
        [TOKYO_KEY, { kind: 'null' }],
        [KYOTO_KEY, { kind: 'null' }],
      ]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(result.pins).toEqual([]);
    expect(result.ungeocoded.map((u) => u.reason)).toEqual([
      "We couldn't find this place on the map.",
    ]);
  });

  it('draws both pins but no line for an implausibly long bus leg, with no entry', async () => {
    dbState.rows = [makeTransit('seg-bus', { ...SHINKANSEN, mode: 'bus' })];
    const lisbon = { lat: 38.7223, lng: -9.1393 };
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map<string, object>([
        ['station:bus:jp:tokyo station', hit(TOKYO)],
        ['station:bus:jp:kyoto station', hit(lisbon)],
      ]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(result.pins).toHaveLength(2);
    expect(result.arcs).toEqual([]);
    expect(result.ungeocoded).toEqual([]);
  });

  it('pins a leg with only one station named, without an entry', async () => {
    dbState.rows = [makeTransit('seg-train', { toName: 'Kyoto Station' })];
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map<string, object>([[KYOTO_KEY, hit(KYOTO)]]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(result.pins).toHaveLength(1);
    expect(result.arcs).toEqual([]);
    expect(result.ungeocoded).toEqual([]);
  });

  it('decodes a full origin Plus Code without waiting on the cache', async () => {
    dbState.rows = [
      makeTransit('seg-train', {
        toName: 'Kyoto Station',
        fromName: 'Tokyo Station',
        fromPlusCode: '8Q7XMQJ8+FV',
      }),
    ];
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map<string, object>([[KYOTO_KEY, hit(KYOTO)]]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(result.arcs).toHaveLength(1);
    expect(result.arcs[0]!.originLat).toBeCloseTo(35.68, 1);
    expect(geocodingMocks.enqueueGeocodeFetch).not.toHaveBeenCalled();
  });

  it('labels an end with only a Plus Code by its role, not the other station', async () => {
    dbState.rows = [
      makeTransit('seg-train', { fromName: 'Tokyo Station', plusCode: '8Q6QXQXV+8G' }),
    ];
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map<string, object>([[TOKYO_KEY, hit(TOKYO)]]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(result.pins.map((p) => [p.endpoint, p.label])).toEqual([
      ['origin', 'Tokyo Station'],
      ['destination', 'Arrival'],
    ]);
  });

  it('keeps car legs on the single-pin path', async () => {
    dbState.rows = [makeTransit('seg-car', { ...SHINKANSEN, mode: 'car' })];
    geocodingMocks.buildGeocodeQuery.mockReturnValue('Kyoto Station');
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map<string, object>([['kyoto station', hit(KYOTO)]]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(result.pins).toHaveLength(1);
    expect(result.pins[0]!.endpoint).toBeUndefined();
    expect(result.arcs).toEqual([]);
  });

  it('gives a round trip its own pins and line per leg and enqueues a shared miss once', async () => {
    dbState.rows = [
      makeTransit('seg-out', SHINKANSEN),
      makeTransit('seg-back', { fromName: 'Kyoto Station', toName: 'Tokyo Station' }),
      makeHotel({ id: 'seg-hotel', countryCode: 'JP' }),
    ];
    geocodingMocks.buildGeocodeQuery.mockReturnValue('Hotel California');
    geocodingMocks.getCachedMany.mockResolvedValue(
      new Map<string, object>([
        [TOKYO_KEY, hit(TOKYO)],
        [KYOTO_KEY, { kind: 'miss' }],
        ['hotel california', { kind: 'null' }],
      ]),
    );

    const result = await getTripMapDataForUser('user-1', 'trip-1');

    expect(geocodingMocks.enqueueGeocodeFetch).toHaveBeenCalledExactlyOnceWith(
      'station:train:jp:Kyoto Station',
    );
    expect(result.pins.filter((p) => p.kind === 'transit')).toHaveLength(2);
    const ids = result.ungeocoded.map((u) => u.segmentId);
    expect(ids).toEqual([...new Set(ids)]);
    expect(ids.sort()).toEqual(['seg-back', 'seg-hotel', 'seg-out']);
  });
});
