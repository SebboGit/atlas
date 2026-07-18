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

import { getJobs } from '@/lib/jobs';
import { log } from '@/lib/log';
import type { Segment } from '@/lib/segments';

import { getCachedOrFetch } from './cache';
import { getGeocoder } from './index';
import { normalizeQuery } from './normalize';
import { buildGeocodeQuery } from './segment-query';

export const GEOCODE_FETCH_JOB = 'geocode-fetch';

export interface GeocodeFetchJobData {
  query: string;
}

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
  // buildGeocodeQuery output is geocoder-ready (ADR-0018): address
  // branches are noise-stripped inside it, name branches deliberately
  // are not — re-applying normalizeForGeocoder here would delete
  // tokens from number-branded venue names ("Room 39, Bangkok").
  const nextQuery = buildGeocodeQuery(args.segment);
  if (nextQuery === null || nextQuery === '') return;

  if (args.prior) {
    // An edit that didn't change the derived query (e.g. a date, or a
    // postcode inside an address the normalizer strips) is a no-op.
    const priorQuery = buildGeocodeQuery(args.prior);
    if (priorQuery === nextQuery) return;
  }

  enqueueGeocodeFetch(nextQuery);
}

/**
 * Enqueue a background geocode for a free-text query. Used by both the
 * segment lifecycle hook AND the trip-map repo when it encounters a
 * cache miss — the repo can't know whether the segment was created
 * before or after the lifecycle hook landed, so it fires defensively
 * on miss. Cross-process deduplication via pg-boss's `singletonKey`
 * means two rapid page views of the same trip don't fan out into
 * duplicate Nominatim calls, even across app and worker.
 */
export function enqueueGeocodeFetch(query: string): void {
  const trimmed = query.trim();
  if (trimmed === '') return;
  const singletonKey = normalizeQuery(trimmed);
  const payload: GeocodeFetchJobData = { query: trimmed };
  // Floating promise: callers expect a synchronous fire-and-forget.
  // A queueing failure is logged and dropped — the next cache miss
  // re-fires.
  void getJobs()
    .send(GEOCODE_FETCH_JOB, payload, { singletonKey })
    .catch((err) => {
      // The singletonKey is the normalised free-text address (hotel
      // name + street, activity title + city) the user typed; log the
      // length only so a failure is debuggable without leaking user
      // content into the structured-log stream.
      log.warn(
        {
          err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown',
          singletonKeyLen: singletonKey.length,
        },
        'geocoding.lifecycle.enqueue_failed',
      );
    });
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
