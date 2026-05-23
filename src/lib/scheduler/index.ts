// Worker-side registration of every named job pg-boss is expected to
// run — handlers AND recurring schedules. Called once from
// `scripts/worker.ts` after `getJobs().start()` has migrated the
// pg-boss schema.
//
// Single source of truth for "what the worker container actually
// does." Adding a new background job is a matter of importing its
// `JOB_NAME` constant and handler here and (if scheduled) adding a
// `jobs.schedule()` call below.
//
// Schedules and timezone are env-overridable so an operator can shift
// the run window without rebuilding the image. Defaults assume UTC,
// matching what a fresh container reports.

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  EXTRACTION_JOB,
  runExtractionJob,
  type ExtractionJobData,
} from '@/lib/documents/extraction-job';
import {
  GEOCODE_FETCH_JOB,
  runGeocodeFetchJob,
  type GeocodeFetchJobData,
} from '@/lib/geocoding/lifecycle';
import type { Jobs } from '@/lib/jobs';
import { log } from '@/lib/log';
import { ALL_TARGETS, pruneLabel, runPrune } from '@/lib/maintenance/prune';
import { runStatusSweep } from '@/lib/maintenance/status';

const PRUNE_JOB = 'prune';
const STATUS_SWEEP_JOB = 'status-sweep';

const DEFAULT_PRUNE_SCHEDULE = '40 3 * * *'; // 03:40 UTC daily
const DEFAULT_STATUS_SCHEDULE = '5 0 * * *'; // 00:05 UTC daily
const DEFAULT_TZ = 'UTC';

// `db` is passed in by the entrypoint rather than imported, so this
// module respects the "feature code doesn't reach into @/db/*"
// boundary — only the entrypoint and maintenance libs touch the DB.
export async function registerWorkerJobs(
  jobs: Jobs,
  db: NodePgDatabase<Record<string, unknown>>,
): Promise<void> {
  // ---- Ad-hoc handlers ----
  //
  // Extraction: bump the active-state timeout from pg-boss's default
  // 15 min to 30 min. CPU Ollama on a large PDF can legitimately run
  // 5-10 min; we want pg-boss to consider that healthy, not stuck. The
  // existing `extractionStartedAt` claim mechanism makes any eventual
  // retry idempotent (one row wins).
  await jobs.register<ExtractionJobData>(EXTRACTION_JOB, runExtractionJob, {
    expireInSeconds: 1800,
  });
  // Geocode-fetch: `'short'` enforces "at most one queued job per
  // singletonKey" at the pg-boss level. Without this, the default
  // `'standard'` policy stores `singletonKey` but does NOT dedupe
  // sends — so two rapid page views for the same address would both
  // fan out to Nominatim. With `'short'`, the second send is a no-op
  // while the first is queued or running. Cross-process correct;
  // replaces the per-process in-flight Set the InlineJobs path used.
  await jobs.register<GeocodeFetchJobData>(GEOCODE_FETCH_JOB, runGeocodeFetchJob, {
    policy: 'short',
  });

  // ---- Scheduled handlers ----
  await jobs.register<null>(PRUNE_JOB, async () => {
    const startedAt = Date.now();
    log.info({ job: PRUNE_JOB }, 'worker.job.started');
    try {
      const counts = await runPrune(db, ALL_TARGETS, new Date(), true);
      const total = counts.reduce((sum, c) => sum + c.expired, 0);
      log.info(
        {
          job: PRUNE_JOB,
          total,
          durationMs: Date.now() - startedAt,
          counts: counts.map((c) => ({ table: pruneLabel(c.target), expired: c.expired })),
        },
        'worker.job.completed',
      );
    } catch (err) {
      // Rethrow so pg-boss surfaces the failure and applies retry
      // semantics; the log line gives operators something searchable
      // without scraping pg-boss's `archive` table.
      log.error(
        { job: PRUNE_JOB, err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown' },
        'worker.job.failed',
      );
      throw err;
    }
  });

  await jobs.register<null>(STATUS_SWEEP_JOB, async () => {
    const startedAt = Date.now();
    log.info({ job: STATUS_SWEEP_JOB }, 'worker.job.started');
    try {
      const counts = await runStatusSweep(db, new Date());
      log.info(
        {
          job: STATUS_SWEEP_JOB,
          plannedToActive: counts.plannedToActive,
          activeToCompleted: counts.activeToCompleted,
          durationMs: Date.now() - startedAt,
        },
        'worker.job.completed',
      );
    } catch (err) {
      log.error(
        {
          job: STATUS_SWEEP_JOB,
          err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown',
        },
        'worker.job.failed',
      );
      throw err;
    }
  });

  // ---- Schedules ----
  const tz = process.env.CRON_TZ?.trim() || DEFAULT_TZ;
  const pruneSchedule = process.env.CRON_PRUNE_SCHEDULE?.trim() || DEFAULT_PRUNE_SCHEDULE;
  const statusSchedule = process.env.CRON_STATUS_SCHEDULE?.trim() || DEFAULT_STATUS_SCHEDULE;

  await jobs.schedule(PRUNE_JOB, pruneSchedule, null, { tz });
  await jobs.schedule(STATUS_SWEEP_JOB, statusSchedule, null, { tz });

  log.info(
    {
      schedules: [
        { job: PRUNE_JOB, cron: pruneSchedule },
        { job: STATUS_SWEEP_JOB, cron: statusSchedule },
      ],
      tz,
    },
    'worker.schedules.registered',
  );
}

// Exported so the worker entrypoint can run the status sweep ONCE at
// boot — the "newly-upgraded data catches up before the next firing"
// backfill. Idempotent (the SQL only moves rows that match the rules),
// so running it at boot AND on schedule is harmless.
export { runStatusSweep };
