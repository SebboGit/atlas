// Daily idempotent sweep that advances `trip_status` by date.
//
// Forward-only — the sweep never moves a trip backward, even if a user
// edits dates such that a completed trip's endDate is now in the
// future. User edits are treated as intentional; reverting them
// silently would be more surprising than helpful.
//
// Transitions:
//
//   planned → active     when startDate <= today
//                        AND (endDate IS NULL OR endDate >= today)
//
//   active  → completed  when endDate IS NOT NULL AND endDate < today
//
// "today" means **start-of-day UTC** — not the current wall-clock
// instant. Trip dates are stored as `YYYY-MM-DDT00:00:00Z` (the date
// picker writes midnight UTC), so comparing against the raw `new Date()`
// would mark a trip ending today as completed at 00:05 UTC of its own
// last day. Both call sites (`runStatusSweep` and `classifyTransition`)
// truncate their `now` argument to UTC midnight to avoid that.
//
// Never touched:
//
//   - archived (terminal)
//   - completed (terminal-ish; only manual edits move it)
//   - trips with null startDate (wishlist trips, ADR-0003)
//   - open-ended trips (null endDate) once active — they stay 'active'
//     until the user sets an endDate or marks completed manually
//
// Two consumers share this module so they always agree on what
// "today" means and what transitions are legal:
//
//   - scripts/worker.ts                — boot-time backfill (once per
//                                        worker start, catches up
//                                        newly-upgraded data)
//   - src/lib/scheduler/index.ts       — scheduled job (daily)

import { and, eq, gte, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { trips } from '@/db/schema/trips';

type AnyDb = NodePgDatabase<Record<string, unknown>>;

type TripStatus = 'planned' | 'active' | 'completed' | 'archived';

export interface StatusSweepCounts {
  plannedToActive: number;
  activeToCompleted: number;
}

// Exported for testability. Both `classifyTransition` and `runStatusSweep`
// route their incoming `now` through this before comparing, so a call
// like `runStatusSweep(db, new Date())` always behaves as "today" rather
// than "this exact moment."
export function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Pure-function mirror of the SQL filters below. Exported so the
// rules can be exercised in unit tests against synthetic Date inputs
// without a database round-trip. The SQL in `runStatusSweep` MUST
// remain equivalent to this function — review them together.
export function classifyTransition(
  trip: { status: string; startDate: Date | null; endDate: Date | null },
  now: Date,
): TripStatus | null {
  const today = startOfDayUtc(now);
  if (trip.status === 'planned') {
    if (trip.startDate === null) return null;
    if (trip.startDate > today) return null;
    if (trip.endDate !== null && trip.endDate < today) return null;
    return 'active';
  }
  if (trip.status === 'active') {
    if (trip.endDate !== null && trip.endDate < today) return 'completed';
    return null;
  }
  // completed, archived: terminal
  return null;
}

export async function runStatusSweep(db: AnyDb, now: Date): Promise<StatusSweepCounts> {
  const today = startOfDayUtc(now);
  // `updatedAt` records the actual write instant — not `today` —
  // because a same-day backfill (worker boot at 14:00 UTC) would
  // otherwise stamp `2026-05-23T00:00:00Z` onto a row whose previous
  // `updatedAt` from a user edit was `2026-05-23T10:00:00Z`. That
  // moves the audit cursor backward and breaks "what changed since
  // last check" queries.
  const changedAt = now;

  // planned → active: in-range trips with a start date that has arrived.
  const activated = await db
    .update(trips)
    .set({ status: 'active', updatedAt: changedAt })
    .where(
      and(
        eq(trips.status, 'planned'),
        isNotNull(trips.startDate),
        lte(trips.startDate, today),
        or(isNull(trips.endDate), gte(trips.endDate, today)),
      ),
    )
    .returning({ id: trips.id });

  // active → completed: trips whose endDate is now in the past.
  // Open-ended (null endDate) trips are deliberately skipped — see the
  // module docstring.
  const completed = await db
    .update(trips)
    .set({ status: 'completed', updatedAt: changedAt })
    .where(and(eq(trips.status, 'active'), isNotNull(trips.endDate), lt(trips.endDate, today)))
    .returning({ id: trips.id });

  return {
    plannedToActive: activated.length,
    activeToCompleted: completed.length,
  };
}
