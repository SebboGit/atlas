// DB-backed geocode cache. See ADR-0010.
//
// The cache wraps a `Geocoder` so the on-the-wire call is bypassed when
// the same normalized query has been resolved (or unresolved) recently
// enough. TTL split: positive hits live for 90 days; negative results
// live for 7 — long enough to absorb repeated renders, short enough
// that a typo'd `locationName` can be corrected without a quarter's
// wait.
//
// Expired rows are NOT purged — `getCachedOrFetch` overwrites them in
// place on the next miss. The cache footprint is bounded by "every
// distinct place that ever got asked about", which is tiny for a
// personal app.

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { geocodeCache } from '@/db/schema';

import { normalizeQuery } from './normalize';
import type { Geocoder, GeocodeResult } from './types';

const SOURCE_NOMINATIM = 'nominatim';
const HIT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const NULL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Outcome of a cache lookup or fetch. `cached` lets the caller log
 * hit/miss without re-querying the DB; trip-map and the lifecycle
 * hook both need it for different reasons.
 */
export interface GetCachedOrFetchResult {
  result: GeocodeResult | null;
  cached: boolean;
}

/**
 * Read-through cache: returns a stored result if one is present and
 * fresh; otherwise calls the geocoder, persists the outcome (positive
 * or negative), and returns it. Never throws — a failed geocoder call
 * surfaces as `result: null` with `cached: false`.
 *
 * Empty / whitespace-only queries short-circuit to `null` without
 * touching the cache or the geocoder.
 */
export async function getCachedOrFetch(
  query: string,
  geocoder: Geocoder,
  now: () => Date = () => new Date(),
): Promise<GetCachedOrFetchResult> {
  const normalized = normalizeQuery(query);
  if (normalized === '') return { result: null, cached: false };

  const current = now();

  const [row] = await db
    .select()
    .from(geocodeCache)
    .where(eq(geocodeCache.queryNormalized, normalized))
    .limit(1);

  if (row && row.expiresAt > current) {
    return { result: rowToResult(row), cached: true };
  }

  const fresh = await geocoder.geocode(query);

  const expiresAt = new Date(current.getTime() + (fresh ? HIT_TTL_MS : NULL_TTL_MS));

  await db
    .insert(geocodeCache)
    .values({
      queryNormalized: normalized,
      lat: fresh?.lat ?? null,
      lng: fresh?.lng ?? null,
      displayName: fresh?.displayName ?? null,
      source: SOURCE_NOMINATIM,
      fetchedAt: current,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: geocodeCache.queryNormalized,
      set: {
        lat: fresh?.lat ?? null,
        lng: fresh?.lng ?? null,
        displayName: fresh?.displayName ?? null,
        source: SOURCE_NOMINATIM,
        fetchedAt: current,
        expiresAt,
      },
    });

  return { result: fresh, cached: false };
}

/** Per-query cache state returned by {@link getCachedMany}. */
export type CachedLookup =
  /** Cache hit with coordinates — the caller can place a pin. */
  | { kind: 'hit'; result: GeocodeResult }
  /** Cache hit with a recorded "no result" — the geocoder gave up; UI surfaces "couldn't find". */
  | { kind: 'null'; displayName: null }
  /** No fresh row — caller treats as "pending" (lifecycle hook will populate). */
  | { kind: 'miss' };

/**
 * Read-only batch lookup. The trip-map repo calls this with every
 * non-flight segment's normalized `locationName` so it can render
 * pins, "couldn't find" entries, and "pending" entries off a single
 * DB round-trip. Never writes; never calls the geocoder.
 *
 * Returns a Map keyed by the *normalized* query — callers normalise
 * on the way in (the same helper this module uses) so both sides
 * agree on the key shape.
 */
export async function getCachedMany(
  queries: ReadonlyArray<string>,
  now: () => Date = () => new Date(),
): Promise<Map<string, CachedLookup>> {
  const out = new Map<string, CachedLookup>();
  const normalized = new Set<string>();
  for (const q of queries) {
    const n = normalizeQuery(q);
    if (n !== '') normalized.add(n);
  }
  if (normalized.size === 0) return out;

  const current = now();
  const rows = await db
    .select()
    .from(geocodeCache)
    .where(inArray(geocodeCache.queryNormalized, Array.from(normalized)));

  for (const row of rows) {
    // Expired rows are treated as miss — the lifecycle hook will
    // re-trigger a fetch on the next mutation, and renders in the
    // meantime get a "pending" pin rather than stale coords.
    if (row.expiresAt <= current) continue;
    const result = rowToResult(row);
    if (result) {
      out.set(row.queryNormalized, { kind: 'hit', result });
    } else {
      out.set(row.queryNormalized, { kind: 'null', displayName: null });
    }
  }

  for (const key of normalized) {
    if (!out.has(key)) out.set(key, { kind: 'miss' });
  }

  return out;
}

function rowToResult(row: {
  lat: number | null;
  lng: number | null;
  displayName: string | null;
}): GeocodeResult | null {
  if (row.lat === null || row.lng === null || row.displayName === null) return null;
  return { lat: row.lat, lng: row.lng, displayName: row.displayName };
}

// Exposed for tests + internal callers that already hold a normalized key.
export { normalizeQuery };
