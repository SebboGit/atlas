// Cache layer tests. The db client is mocked with a minimal chainable
// builder so the cache module's branching (fresh hit, expired hit,
// negative hit, miss → fetch → upsert) can be exercised directly. No
// Postgres required at test time.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Geocoder, GeocodeResult } from './types';

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
  rows: [] as Array<{
    queryNormalized: string;
    lat: number | null;
    lng: number | null;
    displayName: string | null;
    source: string;
    fetchedAt: Date;
    expiresAt: Date;
  }>,
  // Captured filter for the most recent select — index 0 is single
  // lookup (eq), index 1 is batch (inArray). The fake just looks at
  // what keys the caller asked for via a stash variable.
  pendingFilter: null as
    | { kind: 'eq'; key: string }
    | { kind: 'inArray'; keys: ReadonlySet<string> }
    | null,
  upserts: 0,
}));

vi.mock('drizzle-orm', async () => {
  // We intercept `eq` and `inArray` to stash the requested keys in
  // dbState.pendingFilter; the real implementations return Drizzle
  // SQL nodes which the fake db doesn't need to understand.
  return {
    eq: (_col: unknown, value: string) => {
      dbState.pendingFilter = { kind: 'eq', key: value };
      return { __filter: 'eq' };
    },
    inArray: (_col: unknown, values: ReadonlyArray<string>) => {
      dbState.pendingFilter = { kind: 'inArray', keys: new Set(values) };
      return { __filter: 'inArray' };
    },
  };
});

vi.mock('@/db/schema', () => ({
  geocodeCache: { queryNormalized: { __col: 'queryNormalized' } },
}));

vi.mock('@/db/client', () => {
  // Minimal chainable builder that resolves to the right row set when
  // awaited. The chain runs select().from().where().limit?() and
  // delegates the filter to dbState.pendingFilter.
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => buildResultPromise(),
    then: (resolve: (v: FakeRow[]) => unknown, reject?: (e: unknown) => unknown) =>
      buildResultPromise().then(resolve, reject),
  };

  function buildResultPromise(): Promise<FakeRow[]> {
    const filter = dbState.pendingFilter;
    dbState.pendingFilter = null;
    if (!filter) return Promise.resolve([]);
    if (filter.kind === 'eq') {
      const hit = dbState.rows.find((r) => r.queryNormalized === filter.key);
      return Promise.resolve(hit ? [hit] : []);
    }
    return Promise.resolve(dbState.rows.filter((r) => filter.keys.has(r.queryNormalized)));
  }

  const insertChain = {
    values: (row: FakeRow) => ({
      onConflictDoUpdate: ({ set }: { set: Partial<FakeRow> }) => {
        dbState.upserts += 1;
        const idx = dbState.rows.findIndex((r) => r.queryNormalized === row.queryNormalized);
        const next = { ...row, ...set };
        if (idx >= 0) dbState.rows[idx] = next;
        else dbState.rows.push(next);
        return Promise.resolve();
      },
    }),
  };

  return {
    db: {
      select: () => selectChain,
      insert: () => insertChain,
    },
  };
});

// AFTER mocks
import { getCachedMany, getCachedOrFetch } from './cache';

function fakeGeocoder(results: Array<GeocodeResult | null>): Geocoder & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    geocode: async (q: string) => {
      calls.push(q);
      const next = results.shift();
      return next ?? null;
    },
  };
}

const NOW = new Date('2026-05-17T12:00:00Z');
const clock = () => NOW;

beforeEach(() => {
  dbState.rows = [];
  dbState.pendingFilter = null;
  dbState.upserts = 0;
});

describe('getCachedOrFetch', () => {
  it('short-circuits empty queries — no fetch, no db write', async () => {
    const g = fakeGeocoder([{ lat: 1, lng: 2, displayName: 'x' }]);
    const r = await getCachedOrFetch('   ', g, clock);
    expect(r).toEqual({ result: null, cached: false });
    expect(g.calls).toEqual([]);
    expect(dbState.upserts).toBe(0);
  });

  it('on cache miss: calls geocoder and upserts the result with a 90-day TTL', async () => {
    const result: GeocodeResult = { lat: 48.85, lng: 2.29, displayName: 'Paris' };
    const g = fakeGeocoder([result]);

    const r = await getCachedOrFetch('  Paris  ', g, clock);

    expect(r).toEqual({ result, cached: false });
    expect(g.calls).toEqual(['  Paris  ']);
    expect(dbState.rows).toHaveLength(1);
    const row = dbState.rows[0]!;
    expect(row.queryNormalized).toBe('paris');
    expect(row.lat).toBe(48.85);
    expect(row.lng).toBe(2.29);
    expect(row.displayName).toBe('Paris');
    expect(row.source).toBe('nominatim');
    // 90 days exactly.
    const ttlMs = row.expiresAt.getTime() - NOW.getTime();
    expect(ttlMs).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('on geocoder null: upserts a negative-cache row with a 7-day TTL', async () => {
    const g = fakeGeocoder([null]);

    const r = await getCachedOrFetch('jibberishplace', g, clock);

    expect(r).toEqual({ result: null, cached: false });
    expect(dbState.rows).toHaveLength(1);
    const row = dbState.rows[0]!;
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
    expect(row.displayName).toBeNull();
    const ttlMs = row.expiresAt.getTime() - NOW.getTime();
    expect(ttlMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('on fresh cache hit: returns cached and does NOT call the geocoder', async () => {
    dbState.rows.push({
      queryNormalized: 'paris',
      lat: 48.85,
      lng: 2.29,
      displayName: 'Paris, France',
      source: 'nominatim',
      fetchedAt: new Date('2026-04-01T00:00:00Z'),
      expiresAt: new Date('2026-07-01T00:00:00Z'),
    });
    const g = fakeGeocoder([]);

    const r = await getCachedOrFetch('Paris', g, clock);

    expect(r).toEqual({
      result: { lat: 48.85, lng: 2.29, displayName: 'Paris, France' },
      cached: true,
    });
    expect(g.calls).toEqual([]);
    expect(dbState.upserts).toBe(0);
  });

  it('on fresh negative cache hit: returns null cached, no geocoder call', async () => {
    dbState.rows.push({
      queryNormalized: 'jibberishplace',
      lat: null,
      lng: null,
      displayName: null,
      source: 'nominatim',
      fetchedAt: new Date('2026-05-15T00:00:00Z'),
      expiresAt: new Date('2026-05-22T00:00:00Z'),
    });
    const g = fakeGeocoder([{ lat: 1, lng: 2, displayName: 'x' }]);

    const r = await getCachedOrFetch('jibberishplace', g, clock);

    expect(r).toEqual({ result: null, cached: true });
    expect(g.calls).toEqual([]);
  });

  it('on expired cache hit: re-fetches and upserts the new value', async () => {
    dbState.rows.push({
      queryNormalized: 'paris',
      lat: 0,
      lng: 0,
      displayName: 'stale',
      source: 'nominatim',
      fetchedAt: new Date('2025-01-01T00:00:00Z'),
      // Expiry already passed by `NOW` (2026-05-17).
      expiresAt: new Date('2025-04-01T00:00:00Z'),
    });
    const fresh: GeocodeResult = { lat: 48.85, lng: 2.29, displayName: 'Paris, France' };
    const g = fakeGeocoder([fresh]);

    const r = await getCachedOrFetch('Paris', g, clock);

    expect(r).toEqual({ result: fresh, cached: false });
    expect(g.calls).toEqual(['Paris']);
    expect(dbState.rows).toHaveLength(1);
    expect(dbState.rows[0]!.displayName).toBe('Paris, France');
  });
});

describe('getCachedMany', () => {
  it('returns "miss" for queries with no row', async () => {
    const out = await getCachedMany(['Paris', 'Berlin'], clock);
    expect(out.get('paris')).toEqual({ kind: 'miss' });
    expect(out.get('berlin')).toEqual({ kind: 'miss' });
  });

  it('returns "hit" with the cached coords for fresh positive rows', async () => {
    dbState.rows.push({
      queryNormalized: 'paris',
      lat: 48.85,
      lng: 2.29,
      displayName: 'Paris',
      source: 'nominatim',
      fetchedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000),
    });

    const out = await getCachedMany(['Paris', 'Berlin'], clock);
    expect(out.get('paris')).toEqual({
      kind: 'hit',
      result: { lat: 48.85, lng: 2.29, displayName: 'Paris' },
    });
    expect(out.get('berlin')).toEqual({ kind: 'miss' });
  });

  it('returns "null" for fresh negative rows', async () => {
    dbState.rows.push({
      queryNormalized: 'jibberishplace',
      lat: null,
      lng: null,
      displayName: null,
      source: 'nominatim',
      fetchedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    const out = await getCachedMany(['jibberishplace'], clock);
    expect(out.get('jibberishplace')).toEqual({ kind: 'null', displayName: null });
  });

  it('treats expired rows as miss', async () => {
    dbState.rows.push({
      queryNormalized: 'paris',
      lat: 1,
      lng: 2,
      displayName: 'x',
      source: 'nominatim',
      fetchedAt: new Date('2024-01-01T00:00:00Z'),
      expiresAt: new Date('2024-04-01T00:00:00Z'),
    });

    const out = await getCachedMany(['Paris'], clock);
    expect(out.get('paris')).toEqual({ kind: 'miss' });
  });

  it('normalises and de-duplicates input queries', async () => {
    const out = await getCachedMany(['  Paris  ', 'PARIS', 'paris', ''], clock);
    // 'paris' is the single resulting key; empty query is dropped.
    expect(Array.from(out.keys())).toEqual(['paris']);
  });
});
