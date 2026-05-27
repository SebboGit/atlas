// Batch coord lookup for a list of places (segments or wishlist items).
// Single source of truth for the chain that resolves a place row to its
// cached coordinates:
//
//   buildGeocodeQuery → normalizeForGeocoder → normalizeQuery → cache
//
// The trip-map repo runs the same chain to render pins. This helper
// exists for the OTHER render sites (segment cards on itinerary tabs,
// wishlist cards on /wishlist) where the cards want to draw the Plus
// Code badge but don't otherwise need the trip-map's pin shape.

import { getCachedMany } from './cache';
import { normalizeQuery } from './normalize';
import { normalizeForGeocoder } from './normalize-for-geocoder';
import { buildGeocodeQuery, type PlaceLike } from './segment-query';

/**
 * Resolve a list of places to a map of `id → { lat, lng }`. Places with
 * no geocodable identity (e.g. a transit segment with no destination, a
 * note, a flight) are absent from the result map. Cache misses (the
 * worker hasn't filled the row yet) and explicit null results
 * (Nominatim returned nothing) are also absent — the caller treats
 * absence as "no badge to draw."
 *
 * Single DB round-trip regardless of input size.
 */
export async function getPlaceCoordsMap(
  places: ReadonlyArray<PlaceLike & { id: string }>,
): Promise<Map<string, { lat: number; lng: number }>> {
  const view = await getPlaceCoordsView(places);
  return view.coordsById;
}

export interface PlaceCoordsView {
  /** Resolved id → { lat, lng } map. Same shape `getPlaceCoordsMap` returns. */
  coordsById: Map<string, { lat: number; lng: number }>;
  /**
   * Count of geocodable places whose cache row is a miss (worker
   * hasn't filled yet). Drives the client-side router-refresh poll
   * so newly-saved segments surface their badge without a manual
   * reload. Excludes cache hits AND null results (the worker
   * already ran and gave up) so the poll stops bouncing on a place
   * Nominatim can't resolve.
   */
  pendingCount: number;
}

/**
 * Same lookup as {@link getPlaceCoordsMap}, plus a count of places
 * that have a geocodable identity but no resolved cache row yet — i.e.
 * the rows the page would expect to surface on a near-future render
 * once the worker finishes. Pages thread `pendingCount` into
 * `<GeocodePoller>` to silently revalidate.
 */
export async function getPlaceCoordsView(
  places: ReadonlyArray<PlaceLike & { id: string }>,
): Promise<PlaceCoordsView> {
  const queries: { id: string; key: string }[] = [];
  for (const place of places) {
    const raw = buildGeocodeQuery(place);
    if (raw === null) continue;
    const key = normalizeForGeocoder(raw);
    if (key === '') continue;
    queries.push({ id: place.id, key });
  }
  if (queries.length === 0) return { coordsById: new Map(), pendingCount: 0 };

  const cache = await getCachedMany(queries.map((q) => q.key));
  const coordsById = new Map<string, { lat: number; lng: number }>();
  let pendingCount = 0;
  for (const { id, key } of queries) {
    const cached = cache.get(normalizeQuery(key));
    if (cached?.kind === 'hit') {
      coordsById.set(id, { lat: cached.result.lat, lng: cached.result.lng });
      continue;
    }
    if (cached?.kind === 'miss' || cached === undefined) {
      // No cache row at all — the worker hasn't fired yet (just-saved
      // segment) or hasn't completed (in-flight job). Worth polling.
      pendingCount += 1;
    }
    // `kind === 'null'` falls through silently: the row exists and
    // says "no result", so a refresh wouldn't change anything until
    // the negative-TTL sweep.
  }
  return { coordsById, pendingCount };
}
