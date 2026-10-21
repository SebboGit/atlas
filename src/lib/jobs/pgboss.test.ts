// DB-integration tests for PgBossJobs.getQueueHealth. Skipped cleanly
// when DATABASE_URL is unset, mirroring segments/repo.test.ts and
// auth/jit-user.test.ts.
//
// The whole correctness argument for getQueueHealth rests on its raw
// SQL behaving against a real pg-boss v12 schema — the partitioned
// `pgboss.job` table, the ordered `job_state` enum (`state < 'active'`
// = waiting), and node-postgres's int8/numeric → JS coercion. Those
// can't be proven by mocking; this exercises them end-to-end so a
// future pg-boss bump that shifts the schema fails here instead of
// silently breaking the trip-map "worker down" banner.
//
// Uses a dedicated throwaway queue so it never touches the real
// geocode-fetch queue, and the 'app' role so it doesn't start the
// supervisor / cron clock. Cleans its jobs up in afterAll.

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgBossJobs } from './pgboss';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const TEST_QUEUE = 'health-probe-test';

describeIfDb('PgBossJobs.getQueueHealth (DB integration)', () => {
  let jobs: PgBossJobs;
  let pool: Pool;

  beforeAll(async () => {
    jobs = new PgBossJobs(DATABASE_URL as string, 'app');
    await jobs.start();
    pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    // Clear anything left by a prior interrupted run.
    await pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [TEST_QUEUE]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [TEST_QUEUE]).catch(() => {});
    await pool.end();
    await jobs.stop();
  });

  it('reports 0 / null for an unknown queue (no matching partition, no error)', async () => {
    // Proves the SELECT against the partitioned parent doesn't throw
    // when no partition matches `name`, and that an empty min() maps to
    // null rather than NaN.
    const health = await jobs.getQueueHealth('queue-that-never-existed-xyz');
    expect(health).toEqual({ pendingCount: 0, oldestPendingAgeMs: null });
  });

  it('counts a freshly-enqueued job as pending with a small, real age', async () => {
    await jobs.send(TEST_QUEUE, { probe: true });

    const health = await jobs.getQueueHealth(TEST_QUEUE);

    // `state < 'active'` must catch the just-created job.
    expect(health.pendingCount).toBeGreaterThanOrEqual(1);
    // extract(epoch ...) must coerce to a finite JS number, not a
    // string or NaN — a fresh job is well under the 60s stale window.
    expect(typeof health.oldestPendingAgeMs).toBe('number');
    expect(health.oldestPendingAgeMs as number).toBeGreaterThanOrEqual(0);
    expect(health.oldestPendingAgeMs as number).toBeLessThan(60_000);
  });
});

const SHAPE_QUEUE = 'queue-shape-test';

describeIfDb('PgBossJobs.register queue options (DB integration)', () => {
  let app: PgBossJobs;
  let worker: PgBossJobs;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    app = new PgBossJobs(DATABASE_URL as string, 'app');
    worker = new PgBossJobs(DATABASE_URL as string, 'worker');
    await app.start();
    await pool.query(`DELETE FROM pgboss.queue WHERE name = $1`, [SHAPE_QUEUE]).catch(() => {});
  });

  afterAll(async () => {
    await worker.stop();
    await app.stop();
    await pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [SHAPE_QUEUE]).catch(() => {});
    await pool.query(`DELETE FROM pgboss.queue WHERE name = $1`, [SHAPE_QUEUE]).catch(() => {});
    await pool.end();
  });

  it('applies retry options to a queue the app process created first', async () => {
    // The app's send() creates the queue with pg-boss defaults. pg-boss's
    // create_queue is ON CONFLICT DO NOTHING, so the worker's options only
    // land if register() updates the existing row.
    await app.send(SHAPE_QUEUE, { probe: true });

    // A policy on an existing queue must not make register() throw —
    // pg-boss refuses policy changes, so it is left out of the update.
    await worker.register(SHAPE_QUEUE, async () => {}, {
      policy: 'short',
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    });

    const { rows } = await pool.query<{
      retry_limit: number;
      retry_delay: number;
      retry_backoff: boolean;
    }>(`SELECT retry_limit, retry_delay, retry_backoff FROM pgboss.queue WHERE name = $1`, [
      SHAPE_QUEUE,
    ]);
    expect(rows[0]).toEqual({ retry_limit: 3, retry_delay: 30, retry_backoff: true });
  });
});

const THROTTLE_QUEUE = 'throttle-test';

describeIfDb('PgBossJobs.send throttling (DB integration)', () => {
  let jobs: PgBossJobs;
  let pool: Pool;

  beforeAll(async () => {
    jobs = new PgBossJobs(DATABASE_URL as string, 'app');
    await jobs.start();
    pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    await pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [THROTTLE_QUEUE]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [THROTTLE_QUEUE]).catch(() => {});
    await pool.end();
    await jobs.stop();
  });

  it('accepts one job per key per window on a standard-policy queue', async () => {
    const opts = { singletonKey: 'user-1', singletonSeconds: 60 };
    await jobs.send(THROTTLE_QUEUE, { n: 1 }, opts);
    await jobs.send(THROTTLE_QUEUE, { n: 2 }, opts);
    await jobs.send(THROTTLE_QUEUE, { n: 3 }, { ...opts, singletonKey: 'user-2' });

    const { rows } = await pool.query<{ key: string }>(
      `SELECT singleton_key AS key FROM pgboss.job WHERE name = $1 ORDER BY singleton_key`,
      [THROTTLE_QUEUE],
    );
    expect(rows.map((r) => r.key)).toEqual(['user-1', 'user-2']);
  });
});
