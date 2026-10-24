// Batch coord lookup for a list of places (segments or wishlist items).
// Single source of truth for the chain that resolves a place row to its
// cached coordinates:
//
//   buildGeocodeQuery (geocoder-ready, ADR-0018) — or, per end of a train /
//   bus / ferry, buildTransitEndpointQueries (ADR-0019) → normalizeQuery → cache
//
// The trip-map repo runs the same chain to render pins. This helper
// exists for the OTHER render sites (segment cards on itinerary tabs,
// wishlist cards on /wishlist) where the cards want to draw the Plus
// Code badge but don't otherwise need the trip-map's pin shape.

import type { TransitEndpointMode } from '@/lib/segments/transit-endpoints';

import { getCachedMany } from './cache';
import { enqueueGeocodeFetch } from './enqueue';
import { normalizeQuery } from './normalize';
import { decodePlusCode, tryParsePlusCode } from './plus-code';
import { buildGeocodeQuery, buildTransitEndpointQueries, type PlaceLike } from './segment-query';
import { implausibleEnds, type GuardedEnd } from './station-guard';
import { tryParseStationQuery } from './station-query';
import type { PlaceCoords, TransitEndpointCoords, TransitEndpointPlace } from './types';

export type { PlaceCoords, PlaceCoordsEntry, TransitEndpointCoords } from './types';

/**
 * Resolve a list of places to a map of `id → { lat, lng, city }`.
 * Places with no geocodable identity (e.g. a car leg with no names, a
 * note, a flight) are absent from the result map. Cache
 * misses (the worker hasn't filled the row yet) and explicit null
 * results (the geocoder returned nothing) are also absent — the caller
 * treats absence as "no badge to draw."
 *
 * Single DB round-trip regardless of input size.
 */
export async function getPlaceCoordsMap(
  places: ReadonlyArray<PlaceLike & { id: string }>,
): Promise<Map<string, PlaceCoords>> {
  const view = await getPlaceCoordsView(places);
  return view.coordsById;
}

export interface PlaceCoordsView {
  /**
   * Resolved id → primary `{ lat, lng, city }` (same shape
   * `getPlaceCoordsMap` returns). Train / bus / ferry entries also carry
   * `endpoints`, and exist when either end resolved. An end the station
   * guard doubts carries `implausible` (station-guard.ts) — the same
   * verdict that withholds the trip map's line for that leg — and so does
   * the entry itself when its primary point is one.
   */
  coordsById: Map<
    string,
    PlaceCoords & { implausible?: boolean; endpoints?: TransitEndpointCoords }
  >;
  /**
   * Count of geocodable lookups whose cache row is a miss (worker
   * hasn't filled yet) — one per unresolved transit end. Drives the
   * client-side router-refresh poll so newly-saved segments surface
   * their badge without a manual reload. Excludes cache hits AND null
   * results (the worker already ran and gave up) so the poll stops
   * bouncing on a place the geocoder can't resolve.
   */
  pendingCount: number;
}

type Role = 'primary' | 'origin' | 'destination';

/** A resolved place plus what the station guard needs to judge it. */
type Resolved = PlaceCoords & Pick<GuardedEnd, 'source' | 'station'>;

/**
 * Same lookup as {@link getPlaceCoordsMap}, plus a count of places
 * that have a geocodable identity but no resolved cache row yet — i.e.
 * the rows the page would expect to surface on a near-future render
 * once the worker finishes. Pages thread `pendingCount` into
 * `<GeocodePoller>` to silently revalidate.
 */
export async function getPlaceCoordsView(
  places: ReadonlyArray<PlaceLike & { id: string }>,
  opts: {
    /**
     * Enqueue a fetch for every miss, not just transit ends. The reminder
     * sweep sets it: a hotel saved months before the trip has an expired
     * row by the time its reminder is due, and nothing else would refresh
     * it unless someone opened the trip map.
     */
    fetchAllMisses?: boolean;
  } = {},
): Promise<PlaceCoordsView> {
  // One lookup per place — or per end for train / bus / ferry (ADR-0019).
  // `fetchOnMiss`: those transit lookups enqueue their own misses. Their
  // name-only keys moved to station keys, so an existing row would
  // otherwise lose its badge until someone opened the trip map; a Plus
  // Code or address end is treated the same way for simplicity. Other
  // types keep the read-only behaviour — a miss there means the
  // lifecycle hook's job is still running.
  const lookups: {
    id: string;
    role: Role;
    key: string;
    fetchOnMiss: boolean;
    // A FULL Plus Code is self-contained — decoded OFFLINE here
    // (microseconds, no cache, no worker round-trip). This is what makes
    // a just-picked / just-typed full code render its badge immediately
    // on save, instead of waiting for the background geocode to populate
    // the cache (and the poller to refresh). The cache row (the worker's
    // reverse geocode of the same code) still supplies the city (#111).
    offline: { lat: number; lng: number } | null;
  }[] = [];
  // Train / bus / ferry place id → its mode, for the station guard's
  // per-mode threshold.
  const endpointModes = new Map<string, TransitEndpointMode>();
  const addLookup = (id: string, role: Role, key: string | null, fetchOnMiss: boolean) => {
    if (key === null || key === '') return;
    const parsed = tryParsePlusCode(key);
    const offline = parsed?.kind === 'full' ? decodePlusCode(parsed.code) : null;
    lookups.push({ id, role, key, fetchOnMiss, offline });
  };
  for (const place of places) {
    const endpoints = buildTransitEndpointQueries(place);
    if (endpoints) {
      endpointModes.set(place.id, endpoints.mode);
      addLookup(place.id, 'origin', endpoints.origin, true);
      addLookup(place.id, 'destination', endpoints.destination, true);
    } else {
      addLookup(place.id, 'primary', buildGeocodeQuery(place), opts.fetchAllMisses ?? false);
    }
  }
  if (lookups.length === 0) return { coordsById: new Map(), pendingCount: 0 };

  const cache = await getCachedMany(lookups.map((l) => l.key));
  let pendingCount = 0;
  const resolved = new Map<string, Partial<Record<Role, Resolved>>>();
  for (const { id, role, key, fetchOnMiss, offline } of lookups) {
    const cached = cache.get(normalizeQuery(key));
    const byRole = resolved.get(id) ?? {};
    resolved.set(id, byRole);
    if (cached?.kind === 'hit') {
      // City backfill: rows fetched before the current locality rules
      // get one background re-resolve so the card's city line appears
      // or upgrades. A SUCCESSFUL re-resolve may legitimately move the
      // pin (re-resolved under the current provider ladder); a failed
      // one leaves the row untouched (see getCachedOrFetch). Fire-and-
      // forget, singleton-keyed — repeated renders coalesce.
      if (cached.cityPending) enqueueGeocodeFetch(key);
      // Offline-decoded coords stay authoritative — the cache row (the
      // worker's reverse geocode of the same code) contributes only the
      // city line.
      byRole[role] = {
        lat: offline?.lat ?? cached.result.lat,
        lng: offline?.lng ?? cached.result.lng,
        city: cached.result.city ?? null,
        // Which rung placed a bare station name — a tagged station hit
        // or the country-free free-text guess. An offline-decoded code
        // is no station key, so the guard never doubts it.
        source: cached.result.source ?? null,
        station: tryParseStationQuery(key) !== null,
      };
      continue;
    }
    if (offline) byRole[role] = { ...offline, city: null };
    if (cached?.kind === 'miss' || cached === undefined) {
      // No cache row at all — the worker hasn't fired yet (just-saved
      // segment) or hasn't completed (in-flight job). Worth polling. An
      // offline-decoded code counts too: its coords are final but its
      // CITY still depends on the worker's reverse geocode — the one
      // case that needs the city most (a place saved with nothing but a
      // Plus Code).
      pendingCount += 1;
      // Singleton-keyed, so repeated renders coalesce into one job.
      if (fetchOnMiss) enqueueGeocodeFetch(key);
    }
    // `kind === 'null'` falls through silently: the row exists and
    // says "no result", so a refresh wouldn't change anything until
    // the negative-TTL sweep.
  }

  const coordsById: PlaceCoordsView['coordsById'] = new Map();
  for (const [id, byRole] of resolved) {
    if (!endpointModes.has(id)) {
      if (byRole.primary) coordsById.set(id, toPlaceCoords(byRole.primary));
      continue;
    }
    const mode = endpointModes.get(id);
    if (!mode) continue;
    const doubtful = implausibleEnds(mode, byRole.origin ?? null, byRole.destination ?? null);
    const origin = toEndpoint(byRole.origin, doubtful.origin);
    const destination = toEndpoint(byRole.destination, doubtful.destination);
    // The destination, unless the guard doubts it and the origin is
    // sound. With both ends doubted the flag rides up to the entry, so
    // a card that badges the primary point can't badge a guess either.
    const primary =
      destination && destination.implausible && origin && !origin.implausible
        ? origin
        : (destination ?? origin);
    if (primary) {
      coordsById.set(id, {
        ...toPlaceCoords(primary),
        ...(primary.implausible && { implausible: true }),
        endpoints: { origin, destination },
      });
    }
  }
  return { coordsById, pendingCount };
}

// The guard's inputs stay internal; callers get plain coordinates.
function toPlaceCoords({ lat, lng, city }: PlaceCoords): PlaceCoords {
  return { lat, lng, city };
}

function toEndpoint(end: Resolved | undefined, implausible: boolean): TransitEndpointPlace | null {
  if (!end) return null;
  return implausible ? { ...toPlaceCoords(end), implausible: true } : toPlaceCoords(end);
}
