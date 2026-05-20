// Public surface of the Jobs module. Feature code imports from here
// only — never from `./inline` — so the implementation is a config
// swap, never a feature rewrite. Kept deliberately domain-free: no
// extraction-specific constants live here.

import { InlineJobs } from './inline';
import type { Jobs } from './types';

export type { Jobs };

// Lazy singleton. The InlineJobs implementation holds no state and is
// safe to share; future implementations (BullMQ-backed) would hold a
// connection pool and likewise want to be a singleton. Tests that
// need a different implementation use `vi.mock('@/lib/jobs', …)`
// rather than runtime injection — see actions.test.ts.
let instance: Jobs | null = null;

export function getJobs(): Jobs {
  if (!instance) instance = new InlineJobs();
  return instance;
}
