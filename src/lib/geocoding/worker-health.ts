// Liveness hint for the background geocode worker. See issue #24.
//
// A `geocode_cache` miss on the trip map has three causes that look
// identical to the user:
//
//   1. a sub-second race — the lifecycle hook just enqueued a fetch and
//      the worker is about to run it (resolves on the next render);
//   2. the worker is down / never started — the geocode-fetch job sits
//      in pg-boss's queue, unconsumed, forever;
//   3. the worker is up but unconfigured (NOMINATIM_CONTACT_EMAIL unset)
//      — runGeocodeFetchJob logs `unconfigured` and RETURNS, so the job
//      *completes* normally yet writes no cache row.
//
// (3) is the trap: the job isn't stuck, so a "stale queued job" check
// alone misses it. We catch it with a direct env check instead, and
// catch (2) with pg-boss queue age. (1) is the benign default.
//
// Both signals are read in the APP process. The worker is a separate
// container, but Atlas runs both off one shared .env, so the app's view
// of NOMINATIM_CONTACT_EMAIL matches the worker's. A split env (app set,
// worker unset) is not a supported deployment and is out of scope here.

import { getJobs } from '@/lib/jobs';
import { log } from '@/lib/log';

import { GEOCODE_FETCH_JOB } from './lifecycle';

export type GeocodeWorkerStatus = 'ok' | 'unconfigured' | 'worker-down';

// A geocode-fetch job that has waited this long without being picked up
// means nothing is draining the queue. A healthy worker drains a fetch
// in ~1-2s; a slow Nominatim call sits in pg-boss 'active' state
// (excluded from the wait query), so this never false-positives on a
// slow upstream. Constant rather than env-tunable — operational
// simplicity, and the value isn't sensitive (it only delays the banner).
const STALE_PENDING_MS = 60_000;

/**
 * Best-effort verdict on whether geocoding can actually complete right
 * now. Only worth calling when the map already has pending (cache-miss)
 * pins — an all-resolved trip needs no banner. Never throws: a failed
 * health query degrades to `'ok'` so it can neither break a map render
 * nor cry wolf on a transient DB hiccup.
 *
 * Mirrors `createNominatimGeocoder`'s gate exactly for the unconfigured
 * check (empty or unset `NOMINATIM_CONTACT_EMAIL`).
 */
export async function getGeocodeWorkerStatus(): Promise<GeocodeWorkerStatus> {
  const contact = process.env.NOMINATIM_CONTACT_EMAIL;
  if (!contact || contact.trim() === '') return 'unconfigured';

  try {
    const { oldestPendingAgeMs } = await getJobs().getQueueHealth(GEOCODE_FETCH_JOB);
    if (oldestPendingAgeMs !== null && oldestPendingAgeMs > STALE_PENDING_MS) {
      return 'worker-down';
    }
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown' },
      'geocoding.worker_health.query_failed',
    );
    return 'ok';
  }
  return 'ok';
}
