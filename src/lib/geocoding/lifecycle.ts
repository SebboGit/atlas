// Bridge: segment lifecycle → background geocode. See ADR-0010.
//
// Called by the segment create/update server actions after a successful
// write. Returns synchronously after scheduling the work — the action's
// response is sent before the geocode actually runs. Idempotent at the
// cache layer: scheduling twice for the same query inside the TTL is
// free (the second fetch is a cache hit).
//
// Geocoding deliberately does NOT write back to the segment row. The
// trip-map repo reads coordinates straight from `geocode_cache` keyed
// on the normalized query string built by `buildGeocodeQuery`, so a
// new pin appears the next time the user opens the map — no segment-
// side migrations, no "geocoded at" timestamp to keep in sync, no
// race between the writer that updated the row and the writer that
// geocoded it.

import { getJobs } from '@/lib/jobs';
import type { Segment } from '@/lib/segments';
import { log } from '@/lib/log';

import { getCachedOrFetch } from './cache';
import { getGeocoder } from './index';
import { normalizeQuery } from './normalize';
import { buildGeocodeQuery } from './segment-query';
import type { Geocoder } from './types';

// Per-process in-flight set. Same query enqueued twice while the first
// fetch is in flight is a no-op. Lost on process restart — fine; the
// next read that misses will simply re-fire once.
//
// Why not write a "pending" sentinel row to the cache instead? The
// sentinel approach survives restarts but adds a third row state (hit
// / null / pending) the read side has to handle. A process-local Set
// is enough for our deployment shape (single Node process, single
// user, low cardinality) and keeps the cache schema honest — every
// row in `geocode_cache` is a real geocoder verdict.
const inFlightQueries = new Set<string>();

export interface GeocodeOnSegmentChangeArgs {
  /** The segment row as written. */
  segment: Segment;
  /**
   * The prior segment row, on the update path. Omit on create. When
   * provided AND the derived geocode query is identical to the new
   * one, the call is a no-op so an edit that didn't change a
   * geocodable field (e.g. just a date) doesn't re-fire a fetch.
   */
  prior?: Segment;
}

/**
 * Schedule a background geocode for a segment that just changed. Fire-
 * and-forget — returns synchronously so the calling server action's
 * response is unaffected. All failure modes (unconfigured geocoder,
 * provider down, no result) surface as log lines, not exceptions.
 */
export function geocodeOnSegmentChange(args: GeocodeOnSegmentChangeArgs): void {
  const nextQuery = buildGeocodeQuery(args.segment);
  if (nextQuery === null || nextQuery.trim() === '') return;

  if (args.prior) {
    const priorQuery = buildGeocodeQuery(args.prior);
    if (priorQuery === nextQuery) return;
  }

  enqueueGeocodeFetch(nextQuery);
}

/**
 * Schedule a background geocode for a free-text query. Used by both
 * the segment lifecycle hook AND the trip-map repo when it encounters
 * a cache miss — the repo can't know whether the segment was created
 * before or after the lifecycle hook landed, so it fires defensively
 * on miss. Per-process deduplication via `inFlightQueries` means two
 * rapid page views of the same trip don't fan out into duplicate
 * Nominatim calls.
 */
export function enqueueGeocodeFetch(query: string): void {
  const trimmed = query.trim();
  if (trimmed === '') return;
  const key = normalizeQuery(trimmed);
  if (inFlightQueries.has(key)) return;
  inFlightQueries.add(key);

  getJobs().enqueue(async () => {
    try {
      let geocoder: Geocoder;
      try {
        // Reading the geocoder inside the job (not at scheduling
        // time) means a missing NOMINATIM_CONTACT_EMAIL surfaces as
        // a log line from the background worker, never as a thrown
        // exception in the user's request path.
        geocoder = getGeocoder();
      } catch (err) {
        log.warn(
          { reason: err instanceof Error ? err.message : 'unknown' },
          'geocoding.lifecycle.unconfigured',
        );
        return;
      }
      // getCachedOrFetch is no-throw by contract.
      await getCachedOrFetch(trimmed, geocoder);
    } finally {
      // Release the in-flight slot whether the fetch succeeded, gave
      // a null result, or the geocoder was unconfigured. A failed
      // fetch leaves no cache row, so the next miss-driven call
      // will re-enqueue legitimately.
      inFlightQueries.delete(key);
    }
  });
}
