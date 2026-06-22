// Cron schedules + timezones for the worker's scheduled jobs. Pure and
// dependency-free on purpose, so the timezone rule can be unit-tested
// without booting the handler graph (db client, extraction, geocoding)
// that `index.ts` pulls in.
//
// The one rule worth its own module: the status sweep is pinned to UTC
// regardless of CRON_TZ. `runStatusSweep` defines its transitions in UTC
// (trip dates are stored as UTC-midnight day tokens and "now" is truncated
// with `startOfDayUtc`, per ADR-0016). If the sweep's trigger runs in a
// non-UTC zone, its firing instant lands in the *previous* UTC day — e.g.
// 00:05 Europe/Berlin is 22:05 the prior UTC day — so "today" is a day
// behind and every planned→active / active→completed transition fires a
// day late. Prune has no calendar-day semantics, so it honors the
// operator's CRON_TZ for run-window placement.

export const DEFAULT_PRUNE_SCHEDULE = '40 3 * * *'; // 03:40 daily (just after the docs snapshot)
export const DEFAULT_STATUS_SCHEDULE = '5 0 * * *'; // 00:05 daily
export const DEFAULT_TZ = 'UTC';

export interface JobSchedule {
  cron: string;
  tz: string;
}

export interface ScheduleConfig {
  prune: JobSchedule;
  status: JobSchedule;
}

/**
 * Resolve the prune + status-sweep schedules from the environment.
 * `CRON_TZ` shifts the prune run window; the status sweep ignores it and
 * always runs in UTC (see the module docstring).
 */
export function resolveScheduleConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ScheduleConfig {
  const tz = env.CRON_TZ?.trim() || DEFAULT_TZ;
  const pruneCron = env.CRON_PRUNE_SCHEDULE?.trim() || DEFAULT_PRUNE_SCHEDULE;
  const statusCron = env.CRON_STATUS_SCHEDULE?.trim() || DEFAULT_STATUS_SCHEDULE;

  return {
    prune: { cron: pruneCron, tz },
    status: { cron: statusCron, tz: DEFAULT_TZ },
  };
}
