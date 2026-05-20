// Inline (same-process) implementation of the Jobs interface.
//
// The work runs on this Node process's event loop, after the
// scheduling call returns. No retries, no persistence, no worker pool:
// if the process exits before the work completes, the work is lost and
// any domain row marked "in-progress" stays that way until the UI
// stale-handler or a future sweep resets it.
//
// When this stops being enough (multi-process, restart-survivability,
// retry policies, scheduled work, fairness across users), the swap door
// is BullMQ + Redis behind the same `Jobs` interface — see
// docs/adr/0006 sibling slot for the eventual ADR. Don't pre-build it.

import { log } from '@/lib/log';

import type { Jobs } from './types';

export class InlineJobs implements Jobs {
  enqueue(work: () => Promise<void>): void {
    // Floating promise. `void` makes the lint rule explicit: we
    // intentionally do not await — the calling server action has
    // already returned, this runs in the background of the same
    // process.
    void work().catch((err) => {
      log.error(
        { err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown' },
        'jobs.inline.handler_failed',
      );
    });
  }
}
