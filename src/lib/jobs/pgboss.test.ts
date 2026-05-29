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
