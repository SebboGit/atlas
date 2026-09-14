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
  /** The CRON_TZ value that failed validation and was replaced with UTC. */
  rejectedTz?: string;
}

/**
 * Resolve the prune + status-sweep schedules from the environment.
 * `CRON_TZ` shifts the prune run window; the status sweep ignores it and
 * always runs in UTC (see the module docstring).
 *
 * An unknown `CRON_TZ` falls back to UTC and is reported via `rejectedTz`.
 * pg-boss's `schedule()` throws on an unknown zone, which would stop the
 * worker from booting — and the app waits on a healthy worker — so a typo
 * in an optional knob must not take the whole stack down.
 */
export function resolveScheduleConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ScheduleConfig {
  const requestedTz = env.CRON_TZ?.trim() || DEFAULT_TZ;
  const tzValid = isKnownTimeZone(requestedTz);
  const tz = tzValid ? requestedTz : DEFAULT_TZ;
  const pruneCron = env.CRON_PRUNE_SCHEDULE?.trim() || DEFAULT_PRUNE_SCHEDULE;
  const statusCron = env.CRON_STATUS_SCHEDULE?.trim() || DEFAULT_STATUS_SCHEDULE;

  return {
    prune: { cron: pruneCron, tz },
    status: { cron: statusCron, tz: DEFAULT_TZ },
    ...(tzValid ? {} : { rejectedTz: requestedTz }),
  };
}

function isKnownTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
