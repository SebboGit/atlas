// Leaf module for enqueueing background geocode-fetch jobs. Split out
// of lifecycle.ts so read-path helpers (place-coords' city backfill)
// can enqueue without importing lifecycle — which pulls in getGeocoder
// via the barrel and would create an import cycle back through it.

import { getJobs } from '@/lib/jobs';
import { log } from '@/lib/log';

import { normalizeQuery } from './normalize';

export const GEOCODE_FETCH_JOB = 'geocode-fetch';

export interface GeocodeFetchJobData {
  query: string;
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
  // re-fires. The try guards a synchronous getJobs() throw (jobs not
  // configured — unit tests, misconfigured env): read-path callers
  // like place-coords must never propagate it.
  let jobs;
  try {
    jobs = getJobs();
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown' },
      'geocoding.lifecycle.enqueue_failed',
    );
    return;
  }
  void jobs.send(GEOCODE_FETCH_JOB, payload, { singletonKey }).catch((err) => {
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
