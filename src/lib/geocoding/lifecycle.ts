// Bridge: segment lifecycle → background geocode. See ADR-0010.
//
// Called by the segment create/update server actions after a successful
// write. Returns synchronously after enqueueing — the action's response
// is sent before the geocode actually runs. Idempotent at two layers:
//
//   - pg-boss `singletonKey` on the normalised query: a second enqueue
//     for an in-flight or queued fetch is silently discarded (cross-
//     process, not just per-process).
//   - The geocode cache: a successful prior fetch makes the next call
//     a DB read.
//
// Geocoding deliberately does NOT write back to the segment row. The
// trip-map repo reads coordinates straight from `geocode_cache` keyed
// on the normalised query string built by `buildGeocodeQuery`, so a
// new pin appears the next time the user opens the map — no segment-
// side migrations, no "geocoded at" timestamp to keep in sync, no race
// between the writer that updated the row and the writer that geocoded
// it.

import { log } from '@/lib/log';
import type { Segment } from '@/lib/segments';

import { getCachedOrFetch } from './cache';
import { enqueueGeocodeFetch, GEOCODE_FETCH_JOB, type GeocodeFetchJobData } from './enqueue';
import { getGeocoder } from './index';
import { normalizeQuery } from './normalize';
import { buildGeocodeQueries } from './segment-query';

// Re-exported for existing consumers (worker registration, health
// checks, the barrel) — the implementation moved to ./enqueue.
export { enqueueGeocodeFetch, GEOCODE_FETCH_JOB };
export type { GeocodeFetchJobData };

export interface GeocodeOnSegmentChangeArgs {
  /** The segment row as written. */
  segment: Segment;
  /**
   * The prior segment row, on the update path. Omit on create. Only
   * queries the prior row didn't already derive are enqueued, so an
   * edit that didn't change a geocodable field (e.g. just a date)
   * doesn't re-fire a fetch.
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
  // buildGeocodeQueries output is geocoder-ready (ADR-0018): address
  // branches are noise-stripped inside it, name branches deliberately
  // are not — re-applying normalizeForGeocoder here would delete
  // tokens from number-branded venue names ("Room 39, Bangkok").
  // Train / bus / ferry derive one query per endpoint (ADR-0019).
  const next = buildGeocodeQueries(args.segment);
  if (next.length === 0) return;

  // An edit that didn't change a derived query (a date, a postcode the
  // normalizer strips, a case-only rename) enqueues nothing; adding or
  // renaming one endpoint enqueues just that endpoint.
  const prior = new Set(
    (args.prior ? buildGeocodeQueries(args.prior) : []).map((q) => normalizeQuery(q)),
  );
  for (const query of next) {
    if (!prior.has(normalizeQuery(query))) enqueueGeocodeFetch(query);
  }
}

/**
 * Worker-side handler for the geocode-fetch job. Registered in
 * scripts/worker.ts. Resolves the query through the cache + Nominatim
 * with the no-throw contract `getCachedOrFetch` provides.
 */
export async function runGeocodeFetchJob(data: GeocodeFetchJobData): Promise<void> {
  // The enqueued query is geocoder-ready from buildGeocodeQuery — do
  // NOT re-apply normalizeForGeocoder here: it is address-shaped
  // stripping, and running it over a name-first query would delete
  // name tokens ("Room 39, Bangkok" → "Bangkok") and fork the cache
  // key away from what the read side computes (ADR-0018).
  const query = data.query.trim();
  if (query === '') return;
  let geocoder;
  try {
    // Reading the geocoder inside the job (not at scheduling time)
    // means a missing NOMINATIM_CONTACT_EMAIL surfaces as a log line
    // from the background worker, never as a thrown exception in the
    // user's request path.
    geocoder = getGeocoder();
  } catch (err) {
    log.warn(
      { reason: err instanceof Error ? err.message : 'unknown' },
      'geocoding.lifecycle.unconfigured',
    );
    return;
  }
  // getCachedOrFetch is no-throw by contract.
  await getCachedOrFetch(query, geocoder);
}
