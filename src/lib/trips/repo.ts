import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db/client';
import { trips, type Trip } from '@/db/schema';

// Re-exported so the feature barrel can surface it without reaching
// into @/db/* itself (which the architecture lint forbids outside
// repos/actions). Type-only — erased at compile time, no runtime cost.
export type { Trip };

import type { TRIP_STATUSES, TripStatus, TripCreateInput, TripUpdateInput } from './validators';

// ─── The visibility boundary (ADR-0015) ──────────────────────────────
// The single source of truth for "can this viewer SEE this trip's
// content." A trip is visible when it's shared with the household OR the
// viewer created it (the 'private' branch). Every content read and every
// content write across the app folds this predicate in — trips, segments,
// the trip map, the visited-country roll-up, stats, and search — so the
// household-sharing rule lives in exactly one place.
//
// It lives here (a repo, allowed to import @/db/* under the architecture
// lint) and is imported by the other feature repos. Trip-ROW mutations
// (update/archive/unarchive/hardDelete/visibility) deliberately do NOT
// use it: those stay strict-owner via `eq(trips.userId, …)`, because the
// creator owns the container even when its contents are shared.
//
// The `!` is safe: `or(...)` only returns `undefined` when every argument
// is undefined, and both arguments here are concrete `eq(...)` clauses.
export function tripVisibleToViewer(viewerId: string): SQL {
  return or(eq(trips.visibility, 'household'), eq(trips.userId, viewerId))!;
}

// Default list view hides archived trips. The page can pass an explicit
// status filter (e.g. ['archived']) to show them.
const ACTIVE_STATUSES: readonly TripStatus[] = ['planned', 'active', 'completed'];

// Hard cap. Personal app, unlikely to hit it — when we need real
// pagination, switch the call site to use paginationParams and add a
// cursor on (startDate, id).
const LIST_LIMIT = 100 as const;

type StatusFilter = (typeof TRIP_STATUSES)[number][] | 'all';

export async function listForUser(
  userId: string,
  opts: { statuses?: StatusFilter } = {},
): Promise<Trip[]> {
  const statuses = opts.statuses ?? ACTIVE_STATUSES;
  // Read = access: the list shows the viewer's own trips plus every
  // household trip (created by anyone). Private trips of other members
  // are excluded by the predicate.
  const visible = tripVisibleToViewer(userId);
  const where =
    statuses === 'all' ? visible : and(visible, inArray(trips.status, statuses as TripStatus[]));

  // Upcoming/recent first; undated drafts sink to the bottom.
  // createdAt is the deterministic tiebreaker.
  return db
    .select()
    .from(trips)
    .where(where)
    .orderBy(sql`${trips.startDate} desc nulls last`, desc(trips.createdAt))
    .limit(LIST_LIMIT);
}

// Wrapped in React.cache so the trip-detail layout and the active tab page
// — both Server Components rendering in the same request — share a single
// PK lookup instead of each issuing it. Mirrors getCurrentUser in
// src/lib/auth/session.ts. No worker/job reaches this, so the request-scoped
// cache is the only context it runs in.
// Read = access: returns the trip when the viewer owns it OR it's a
// household trip. This is the gate the trip-detail pages and (via the
// segment/document repos) the content surfaces lean on, so a household
// member can open a shared trip they didn't create.
export const getByIdForUser = cache(async (userId: string, id: string): Promise<Trip | null> => {
  const rows = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, id), tripVisibleToViewer(userId)))
    .limit(1);
  return rows[0] ?? null;
});

export async function create(userId: string, input: TripCreateInput): Promise<Trip> {
  const [row] = await db
    .insert(trips)
    .values({
      userId,
      title: input.title,
      summary: input.summary,
      status: input.status,
      visibility: input.visibility,
      startDate: input.startDate,
      endDate: input.endDate,
    })
    .returning();
  if (!row) throw new Error('Trip insert returned no row');
  return row;
}

export async function update(
  userId: string,
  id: string,
  patch: TripUpdateInput,
): Promise<Trip | null> {
  // Only set columns the caller actually provided. Zod's partial leaves
  // unset keys as `undefined`, so we filter them out here rather than
  // overwriting good data with NULL.
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.summary !== undefined) set.summary = patch.summary;
  if (patch.status !== undefined) set.status = patch.status;
  // Visibility is owner-controlled, so it rides the owner-only update
  // path below. 'private' is defined relative to the creator, so only
  // the creator can flip it.
  if (patch.visibility !== undefined) set.visibility = patch.visibility;
  if (patch.startDate !== undefined) set.startDate = patch.startDate;
  if (patch.endDate !== undefined) set.endDate = patch.endDate;

  // Owner-only: trip-row edits stay strict-owner even on a household
  // trip whose contents the whole household can edit.
  const [row] = await db
    .update(trips)
    .set(set)
    .where(and(eq(trips.id, id), eq(trips.userId, userId)))
    .returning();
  return row ?? null;
}

export async function archive(userId: string, id: string): Promise<Trip | null> {
  const [row] = await db
    .update(trips)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(and(eq(trips.id, id), eq(trips.userId, userId)))
    .returning();
  return row ?? null;
}

export async function unarchive(userId: string, id: string): Promise<Trip | null> {
  const [row] = await db
    .update(trips)
    .set({ status: 'planned', updatedAt: new Date() })
    .where(and(eq(trips.id, id), eq(trips.userId, userId)))
    .returning();
  return row ?? null;
}

export async function hardDelete(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, userId)))
    .returning({ id: trips.id });
  return rows.length > 0;
}
