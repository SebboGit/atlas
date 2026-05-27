// Tests for getPlaceCoordsMap. Mocks the DB client the same way
// cache.test.ts does — a chainable builder with an in-memory row
// set — so we exercise the full pipeline:
//
//   buildGeocodeQuery → normalizeForGeocoder → normalizeQuery →
//   getCachedMany → result map
//
// The cache-key chain is duplicated across this helper, the trip-map
// repo, and the stats repo. This test pins the chain on this one so a
// future refactor that breaks the chain breaks here loudly.

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeRow {
  queryNormalized: string;
  lat: number | null;
  lng: number | null;
  displayName: string | null;
  source: string;
  fetchedAt: Date;
  expiresAt: Date;
}

const dbState = vi.hoisted(() => ({
  rows: [] as FakeRow[],
  pendingFilter: null as { kind: 'inArray'; keys: ReadonlySet<string> } | null,
}));

vi.mock('drizzle-orm', async () => ({
  eq: () => ({ __filter: 'eq' }),
  inArray: (_col: unknown, values: ReadonlyArray<string>) => {
    dbState.pendingFilter = { kind: 'inArray', keys: new Set(values) };
    return { __filter: 'inArray' };
  },
}));

vi.mock('@/db/schema', () => ({
  geocodeCache: { queryNormalized: { __col: 'queryNormalized' } },
}));

vi.mock('@/db/client', () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve([] as FakeRow[]),
    then: (resolve: (v: FakeRow[]) => unknown, reject?: (e: unknown) => unknown) => {
      const filter = dbState.pendingFilter;
      dbState.pendingFilter = null;
      const out = filter ? dbState.rows.filter((r) => filter.keys.has(r.queryNormalized)) : [];
      return Promise.resolve(out).then(resolve, reject);
    },
  };
  return { db: { select: () => selectChain } };
});

// AFTER mocks
import { getPlaceCoordsMap, getPlaceCoordsView } from './place-coords';

const FUTURE = new Date('2099-01-01');

beforeEach(() => {
  dbState.rows = [];
  dbState.pendingFilter = null;
});

describe('getPlaceCoordsMap', () => {
  it('returns an empty map for an empty input list', async () => {
    const result = await getPlaceCoordsMap([]);
    expect(result.size).toBe(0);
  });

  it('returns an empty map for places with no geocodable identity (notes, flights)', async () => {
    const result = await getPlaceCoordsMap([
      { id: 'note-1', type: 'note', data: { body: 'foo' }, locationName: null },
      {
        id: 'flight-1',
        type: 'flight',
        data: { originAirport: 'LHR', destinationAirport: 'HND' },
        locationName: null,
      },
    ]);
    expect(result.size).toBe(0);
  });

  it('looks up coords by the same chain the lifecycle hook + trip-map repo use', async () => {
    // The lifecycle hook would have written this row under the
    // normalized form of `2-6-15 minami-aoyama, minato, tokyo`.
    dbState.rows.push({
      queryNormalized: '2-6-15 minami-aoyama, minato, tokyo',
      lat: 35.6655,
      lng: 139.717,
      displayName: 'Narisawa, Tokyo, Japan',
      source: 'nominatim',
      fetchedAt: new Date(),
      expiresAt: FUTURE,
    });

    const result = await getPlaceCoordsMap([
      {
        id: 'food-1',
        type: 'food',
        data: { venue: 'Narisawa', address: '2-6-15 Minami-Aoyama, Minato, Tokyo' },
        locationName: null,
      },
    ]);

    expect(result.get('food-1')).toEqual({ lat: 35.6655, lng: 139.717 });
  });

  it('prefers the Plus Code cache key when plusCode is set (address ignored as key)', async () => {
    // Lifecycle hook would have written this row under the trimmed,
    // lowercased Plus Code form — NOT the address.
    dbState.rows.push({
      queryNormalized: 'mq8r+5c chiyoda city, tokyo',
      lat: 35.6968,
      lng: 139.7536,
      displayName: 'Hotel Niwa Tokyo, …',
      source: 'nominatim',
      fetchedAt: new Date(),
      expiresAt: FUTURE,
    });

    const result = await getPlaceCoordsMap([
      {
        id: 'hotel-1',
        type: 'hotel',
        data: {
          propertyName: 'Hotel Niwa Tokyo',
          address: '1-1-16 Misakicho, Chiyoda City, Tokyo 101-0061',
          plusCode: 'MQ8R+5C Chiyoda City, Tokyo',
        },
        locationName: 'Chiyoda',
      },
    ]);

    expect(result.get('hotel-1')).toEqual({ lat: 35.6968, lng: 139.7536 });
  });

  it('omits places whose cache row is a null-result (Nominatim gave up)', async () => {
    dbState.rows.push({
      queryNormalized: "friend's place — drinks",
      lat: null,
      lng: null,
      displayName: null,
      source: 'nominatim',
      fetchedAt: new Date(),
      expiresAt: FUTURE,
    });

    const result = await getPlaceCoordsMap([
      {
        id: 'act-1',
        type: 'activity',
        data: { title: "Friend's place — drinks" },
        locationName: null,
      },
    ]);

    expect(result.has('act-1')).toBe(false);
  });

  it('omits places whose cache row is missing entirely (worker has not filled yet)', async () => {
    const result = await getPlaceCoordsMap([
      {
        id: 'act-1',
        type: 'activity',
        data: { title: 'Brand New Place' },
        locationName: null,
      },
    ]);
    expect(result.has('act-1')).toBe(false);
  });

  it('getPlaceCoordsView reports pendingCount for geocodable cache misses', async () => {
    // One place has a cache hit; one has a null row (worker already
    // ran, no result); one has no row at all (worker pending).
    // pendingCount should count only the third — refreshing won't
    // change the hit or the null result, only the missing row.
    dbState.rows.push(
      {
        queryNormalized: '2-6-15 minami-aoyama, minato, tokyo',
        lat: 35.6655,
        lng: 139.717,
        displayName: 'Narisawa',
        source: 'nominatim',
        fetchedAt: new Date(),
        expiresAt: FUTURE,
      },
      {
        queryNormalized: "friend's place — drinks",
        lat: null,
        lng: null,
        displayName: null,
        source: 'nominatim',
        fetchedAt: new Date(),
        expiresAt: FUTURE,
      },
    );

    const view = await getPlaceCoordsView([
      {
        id: 'food-hit',
        type: 'food',
        data: { venue: 'Narisawa', address: '2-6-15 Minami-Aoyama, Minato, Tokyo' },
        locationName: null,
      },
      {
        id: 'act-null',
        type: 'activity',
        data: { title: "Friend's place — drinks" },
        locationName: null,
      },
      {
        id: 'act-pending',
        type: 'activity',
        data: { title: 'Brand New Place' },
        locationName: null,
      },
      // Not geocodable — should not count toward pending.
      {
        id: 'note-1',
        type: 'note',
        data: { body: 'foo' },
        locationName: null,
      },
    ]);

    expect(view.coordsById.size).toBe(1);
    expect(view.coordsById.has('food-hit')).toBe(true);
    expect(view.pendingCount).toBe(1);
  });

  it('returns only hits in a mixed input — one round-trip, multi-row select', async () => {
    dbState.rows.push(
      {
        queryNormalized: '2-6-15 minami-aoyama, minato, tokyo',
        lat: 35.6655,
        lng: 139.717,
        displayName: 'Narisawa',
        source: 'nominatim',
        fetchedAt: new Date(),
        expiresAt: FUTURE,
      },
      {
        queryNormalized: 'sensō-ji, asakusa',
        lat: 35.7148,
        lng: 139.7967,
        displayName: 'Sensō-ji',
        source: 'nominatim',
        fetchedAt: new Date(),
        expiresAt: FUTURE,
      },
    );

    const result = await getPlaceCoordsMap([
      {
        id: 'food-1',
        type: 'food',
        data: { venue: 'Narisawa', address: '2-6-15 Minami-Aoyama, Minato, Tokyo' },
        locationName: null,
      },
      {
        id: 'act-1',
        type: 'activity',
        data: { title: 'Sensō-ji' },
        locationName: 'Asakusa',
      },
      // No cache row — should be absent from output.
      {
        id: 'act-2',
        type: 'activity',
        data: { title: 'Unmapped Place' },
        locationName: null,
      },
    ]);

    expect(result.size).toBe(2);
    expect(result.get('food-1')).toEqual({ lat: 35.6655, lng: 139.717 });
    expect(result.get('act-1')).toEqual({ lat: 35.7148, lng: 139.7967 });
    expect(result.has('act-2')).toBe(false);
  });
});
