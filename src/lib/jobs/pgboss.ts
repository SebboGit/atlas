// pg-boss-backed implementation of the Jobs interface — see ADR-0012.
//
// One PgBoss instance per Node process. The same class serves both
// roles:
//
//   - The app process imports `getJobs()` and only calls `send()`.
//     Construction uses `{ supervise: false, schedule: false }` so the
//     app never runs maintenance or the cron clock (the worker does).
//
//   - The worker process imports the same module and calls
//     `register()` + `schedule()` + `send()`. Construction uses the
//     pg-boss defaults — supervise (archive cleanup, queue
//     maintenance) and the cron scheduler both run here.
//
// Which role we're in is determined by the env var `JOBS_ROLE`
// (`app` | `worker`). The worker entrypoint sets it to `worker`
// before importing anything; the app inherits the default of `app`.

import { PgBoss } from 'pg-boss';
import type {
  ConstructorOptions,
  Queue as PgBossQueue,
  ScheduleOptions as PgBossScheduleOptions,
  SendOptions as PgBossSendOptions,
} from 'pg-boss';

import { log } from '@/lib/log';

import type { Jobs, JobHandler, RegisterOptions, ScheduleOptions, SendOptions } from './types';

type JobsRole = 'app' | 'worker';

function resolveRole(): JobsRole {
  const raw = process.env.JOBS_ROLE?.trim().toLowerCase();
  if (raw === 'worker') return 'worker';
  return 'app';
}

function buildOptions(role: JobsRole, connectionString: string): ConstructorOptions {
  // The worker drives the cron clock and the supervisor loop; the app
  // process explicitly opts out of both so we don't get duplicate
  // archive sweeps or duplicate cron firings.
  if (role === 'worker') {
    return { connectionString };
  }
  return {
    connectionString,
    supervise: false,
    schedule: false,
  };
}

export class PgBossJobs implements Jobs {
  readonly #role: JobsRole;
  readonly #boss: PgBoss;
  #started: Promise<void> | null = null;
  // Track queues we've created in this process so we don't issue
  // redundant `createQueue` calls on every send/register.
  readonly #ensuredQueues = new Set<string>();

  constructor(connectionString: string, role: JobsRole = resolveRole()) {
    this.#role = role;
    this.#boss = new PgBoss(buildOptions(role, connectionString));
    this.#boss.on('error', (err: unknown) => {
      log.error(
        { err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown', role },
        'jobs.pgboss.error',
      );
    });
  }

  async start(): Promise<void> {
    if (!this.#started) {
      this.#started = (async () => {
        await this.#boss.start();
        log.info({ role: this.#role }, 'jobs.pgboss.started');
      })();
    }
    return this.#started;
  }

  async stop(): Promise<void> {
    try {
      await this.#boss.stop({ graceful: true });
      log.info({ role: this.#role }, 'jobs.pgboss.stopped');
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown' },
        'jobs.pgboss.stop_failed',
      );
    }
  }

  async send<T>(name: string, data: T, opts?: SendOptions): Promise<void> {
    await this.start();
    await this.#ensureQueue(name);
    const sendOpts: PgBossSendOptions = {};
    if (opts?.singletonKey !== undefined) sendOpts.singletonKey = opts.singletonKey;
    // pg-boss's `data` parameter is typed as `object | null` — JSON
    // round-trip means any plain-data payload works at runtime, but
    // the cast keeps the public Jobs interface free of that quirk.
    const id = await this.#boss.send(name, (data ?? null) as object | null, sendOpts);
    log.debug({ name, id, role: this.#role }, 'jobs.pgboss.sent');
  }

  async register<T>(name: string, handler: JobHandler<T>, opts?: RegisterOptions): Promise<void> {
    if (this.#role !== 'worker') {
      // Loud failure — registering handlers on the app process would
      // silently consume jobs that the worker should be running.
      throw new Error(
        `PgBossJobs.register('${name}') called from role='${this.#role}'; handlers may only be registered on the worker process`,
      );
    }
    await this.start();
    await this.#ensureQueue(name, opts);
    await this.#boss.work<T>(name, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data as T);
      }
    });
    log.info(
      { name, policy: opts?.policy ?? 'standard', expireInSeconds: opts?.expireInSeconds },
      'jobs.pgboss.handler_registered',
    );
  }

  async schedule<T>(name: string, cron: string, data: T, opts?: ScheduleOptions): Promise<void> {
    if (this.#role !== 'worker') {
      throw new Error(
        `PgBossJobs.schedule('${name}') called from role='${this.#role}'; schedules may only be declared on the worker process`,
      );
    }
    await this.start();
    await this.#ensureQueue(name);
    const scheduleOpts: PgBossScheduleOptions = {};
    if (opts?.tz) scheduleOpts.tz = opts.tz;
    await this.#boss.schedule(name, cron, (data ?? null) as object | null, scheduleOpts);
    log.info({ name, cron, tz: opts?.tz ?? 'UTC' }, 'jobs.pgboss.schedule_registered');
  }

  // pg-boss v12+ requires explicit queue creation before send/work.
  // `createQueue` is idempotent — calling for an existing queue is a
  // cheap no-op — but we cache locally so repeated sends from a hot
  // path don't issue a network round-trip every time.
  //
  // When `opts` is supplied (only from `register()` on the worker side)
  // and the queue already exists, we `updateQueue` to apply the policy
  // / timeout to the existing row. This way the worker can change a
  // queue's shape between deploys without operators having to run a
  // manual `unschedule` + `createQueue`.
  async #ensureQueue(name: string, opts?: RegisterOptions): Promise<void> {
    if (this.#ensuredQueues.has(name)) {
      if (opts) await this.#applyQueueOptions(name, opts);
      return;
    }
    const createSpec: Partial<PgBossQueue> = {};
    if (opts?.policy) createSpec.policy = opts.policy;
    if (opts?.expireInSeconds !== undefined) createSpec.expireInSeconds = opts.expireInSeconds;
    await this.#boss.createQueue(name, createSpec).catch(async (err: unknown) => {
      // Race with another process is benign — pg-boss raises if the
      // queue already exists; both cases mean "queue is ready". Fall
      // back to `updateQueue` so a queue created previously with
      // defaults still gets reshaped to match the current code.
      log.debug(
        { name, err: err instanceof Error ? err.message : 'unknown' },
        'jobs.pgboss.queue_create_noop',
      );
      if (opts) await this.#applyQueueOptions(name, opts);
    });
    this.#ensuredQueues.add(name);
  }

  async #applyQueueOptions(name: string, opts: RegisterOptions): Promise<void> {
    if (!opts.policy && opts.expireInSeconds === undefined) return;
    try {
      await this.#boss.updateQueue(name, {
        ...(opts.policy ? { policy: opts.policy } : {}),
        ...(opts.expireInSeconds !== undefined ? { expireInSeconds: opts.expireInSeconds } : {}),
      });
    } catch (err) {
      log.warn(
        { name, err: err instanceof Error ? err.message : 'unknown' },
        'jobs.pgboss.queue_update_failed',
      );
    }
  }
}
