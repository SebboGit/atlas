// Background work seam — see ADR-0012.
//
// Three responsibilities behind a single interface:
//
//   - send()      enqueue a named ad-hoc job (called from app code)
//   - register()  attach a handler to a job name (called from worker)
//   - schedule()  declare a recurring named job (called from worker)
//
// The pg-boss implementation backs all three with one Postgres schema
// (`pgboss.*`), one connection, one operational model. Feature code
// imports `Jobs` from this module's index — never from `./pgboss`
// directly — so the implementation stays a config swap.
//
// `register` and `schedule` are deliberately worker-only by convention:
// the app process never registers handlers (it would consume jobs
// meant for the worker) and never declares schedules (the worker is
// the source of truth for cron registrations). The interface doesn't
// enforce this — call discipline does. Two consumers, one container
// each.

export interface SendOptions {
  /**
   * If a job with this key is already pending (queued or running),
   * a second send with the same key is silently discarded. Use for
   * idempotent fan-in (e.g. multiple page views requesting the same
   * geocode while the first is in flight).
   */
  singletonKey?: string;
}

export interface ScheduleOptions {
  /** Timezone for cron expression. Defaults to UTC. */
  tz?: string;
}

/**
 * Per-queue configuration applied at handler-registration time.
 * pg-boss owns the queue table, so these are upserted: registering a
 * handler with `{ policy: 'short' }` reshapes the existing queue if
 * the worker previously created it with defaults.
 */
export interface RegisterOptions {
  /**
   * pg-boss queue policy. The default `'standard'` allows unlimited
   * concurrent and queued jobs and does NOT enforce `singletonKey`
   * uniqueness on sends — set to `'short'` (1 queued per key) or
   * `'singleton'` (1 active per key) for jobs where `send()`
   * deduplication actually matters.
   */
  policy?: 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive' | 'key_strict_fifo';
  /**
   * Active-state timeout in seconds before pg-boss treats a job as
   * stuck and retries / fails it. Default (pg-boss) is 900 (15 min);
   * raise for long-running handlers like document extraction.
   */
  expireInSeconds?: number;
}

export type JobHandler<T> = (data: T) => Promise<void>;

/**
 * Read-only snapshot of a queue's waiting work, read straight from
 * pg-boss's tables. Lets a feature distinguish "the worker is keeping
 * up" from "jobs are piling up because nothing is consuming them"
 * without a heartbeat table — see issue #24.
 */
export interface QueueHealth {
  /** Jobs waiting to start (pg-boss state < 'active': created or retry). */
  pendingCount: number;
  /**
   * Age in ms of the oldest waiting job, or null when none are waiting.
   * A value far above the worker's normal drain time means the queue
   * isn't being consumed (worker down / not started). Jobs already
   * being processed ('active') are excluded, so a slow upstream call
   * doesn't read as a stuck queue.
   *
   * Measured from each job's enqueue time (`created_on`), so it's only
   * a meaningful liveness signal for queues whose jobs are immediately
   * runnable. A queue using `startAfter` delays or retry backoff could
   * have a legitimately-deferred job that reads as "old and waiting" —
   * today's only caller (geocode-fetch) is enqueued for immediate run,
   * so this holds.
   */
  oldestPendingAgeMs: number | null;
}

export interface Jobs {
  /**
   * Initialise the underlying queue. Idempotent — calling twice is
   * safe. The worker entrypoint calls this explicitly before
   * registering handlers; the app side calls it lazily on first send.
   */
  start(): Promise<void>;

  /** Graceful shutdown — finishes in-flight handlers, then stops. */
  stop(): Promise<void>;

  /**
   * Enqueue `data` for the named job. Returns when the row has been
   * persisted to `pgboss.job` (durable) — not when the handler runs.
   * Throws if persistence fails; the caller decides whether that
   * surfaces to the user or is logged and swallowed.
   */
  send<T>(name: string, data: T, opts?: SendOptions): Promise<void>;

  /**
   * Register a handler for a named job. Called once per job name at
   * worker boot. Handler errors trigger pg-boss's retry policy.
   *
   * `opts` lets the worker pin the queue's policy and timeout — the
   * worker is the source of truth for queue shape, and `send()` from
   * the app side will inherit whatever the worker configured here.
   */
  register<T>(name: string, handler: JobHandler<T>, opts?: RegisterOptions): Promise<void>;

  /**
   * Declare a recurring schedule for a named job. Idempotent across
   * restarts — pg-boss upserts the row in `pgboss.schedule`. The job
   * must have a registered handler (typically in the same process).
   */
  schedule<T>(name: string, cron: string, data: T, opts?: ScheduleOptions): Promise<void>;

  /**
   * Read a queue's pending-work snapshot directly from pg-boss's
   * tables. A plain SELECT — does NOT require the queue to be started
   * or registered in this process, so the app side can call it for
   * liveness hints (e.g. the trip map's "geocoding worker may be down"
   * banner). Best-effort: throws only on a genuine DB/query failure,
   * which callers are expected to degrade gracefully around.
   */
  getQueueHealth(name: string): Promise<QueueHealth>;
}
