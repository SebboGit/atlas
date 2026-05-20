// In-stack scheduler for periodic housekeeping. Runs in the dedicated
// `cron` compose service (see docker-compose.yml), not inside the
// Next.js app process — keeping the web server free of "did this
// instance run the 03:40 sweep?" timing concerns.
//
// Today: one job (nightly prune). New jobs (e.g. upcoming-flight
// ntfy reminders) register in `registerJobs()` below.
//
// Schedules and timezone are env-overridable so an operator can shift
// the run window without rebuilding the image. All defaults assume
// UTC, matching what a fresh Alpine container reports.

import { Cron } from 'croner';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { log } from '../log';
import { ALL_TARGETS, pruneLabel, runPrune } from '../maintenance/prune';

const DEFAULT_PRUNE_SCHEDULE = '0 40 3 * * *'; // 03:40 daily (sec min hour ...)
const DEFAULT_TZ = 'UTC';

export type Scheduler = {
  jobs: Cron[];
  stop: () => void;
};

// `db` is passed in by the entrypoint (scripts/cron.ts) rather than imported,
// so this module respects the "feature code doesn't reach into @/db/*"
// boundary — only the entrypoint and the maintenance lib touch the DB.
export function startScheduler(db: NodePgDatabase<Record<string, unknown>>): Scheduler {
  const tz = process.env.CRON_TZ?.trim() || DEFAULT_TZ;
  const pruneSchedule = process.env.CRON_PRUNE_SCHEDULE?.trim() || DEFAULT_PRUNE_SCHEDULE;

  const jobs: Cron[] = [];

  jobs.push(
    new Cron(
      pruneSchedule,
      {
        name: 'prune',
        timezone: tz,
        // `protect` skips overlapping runs. Prune is idempotent and
        // fast, but a stalled job (e.g. the DB is down) shouldn't pile
        // up parallel attempts that would all hit the same lock.
        protect: true,
        // `catch` keeps a thrown job from killing the scheduler — we
        // log it and the next tick still fires on schedule.
        catch: (err) => {
          log.error({ err: serialize(err), job: 'prune' }, 'cron.job.failed');
        },
      },
      async () => {
        const startedAt = Date.now();
        log.info({ job: 'prune' }, 'cron.job.started');
        const counts = await runPrune(db, ALL_TARGETS, new Date(), true);
        const total = counts.reduce((sum, c) => sum + c.expired, 0);
        log.info(
          {
            job: 'prune',
            total,
            durationMs: Date.now() - startedAt,
            counts: counts.map((c) => ({ table: pruneLabel(c.target), expired: c.expired })),
          },
          'cron.job.completed',
        );
      },
    ),
  );

  for (const job of jobs) {
    const next = job.nextRun();
    log.info(
      { job: job.name, schedule: job.getPattern(), timezone: tz, nextRun: next?.toISOString() },
      'cron.job.registered',
    );
  }

  return {
    jobs,
    stop: () => {
      for (const job of jobs) job.stop();
    },
  };
}

function serialize(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { name: 'unknown', message: String(err) };
}
