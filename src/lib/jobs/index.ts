// Public surface of the Jobs module — see ADR-0012.
//
// Feature code imports from here only — never from `./pgboss` — so
// the implementation stays a config swap. Tests that need a stub
// implementation use `vi.mock('@/lib/jobs', …)` to replace
// `getJobs()` with a fake.

import { PgBossJobs } from './pgboss';
import type { Jobs } from './types';

export type { Jobs, JobHandler, RegisterOptions, ScheduleOptions, SendOptions } from './types';

let instance: Jobs | null = null;

export function getJobs(): Jobs {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL must be set before getJobs() is called');
    }
    instance = new PgBossJobs(url);
  }
  return instance;
}

// Reset for tests that need a clean instance — never call from
// production code. Lives here rather than in pgboss.ts so it shares
// the singleton.
export function __resetJobsForTests(): void {
  instance = null;
}
