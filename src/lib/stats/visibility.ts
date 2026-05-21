import { type SQL, sql } from 'drizzle-orm';

/**
 * The single place that decides which trips a given viewer is allowed
 * to aggregate over in the stats dashboard.
 *
 * ─── Today: this is a deliberate no-op. ──────────────────────────────
 * Atlas runs a full-household-sharing model (CLAUDE.md → Extension
 * Points): every trip is visible to every household member, and
 * `trips.userId` records *who created* a trip — it is provenance, not
 * an ownership/ACL boundary. So today every stats query counts every
 * trip, and this builder returns an always-true predicate.
 *
 * The `currentUserId` parameter is threaded in NOW, unused, on purpose.
 * Every stats query already passes it down and every query is already
 * *structured* for per-viewer aggregation. When per-trip privacy lands
 * — the only sanctioned extension is a `trips.visibility` enum on the
 * existing table (NOT an `ownerships` join table) — flipping this on is
 * a one-line change. With `trips` imported from `@/db/schema` inside
 * `repo.ts` and passed in (or referenced there), the body becomes:
 *
 *   return or(
 *     eq(trips.visibility, 'household'),
 *     and(eq(trips.visibility, 'private'), eq(trips.userId, currentUserId)),
 *   )!;
 *
 * Do NOT reference `trips.visibility` anywhere until that column exists
 * — it is not in the schema yet and any SQL touching it fails at
 * runtime. Keeping the predicate boxed in this helper means the feature
 * flips on with a single edit and zero query rewrites. The helper lives
 * outside `repo.ts` (and so cannot import `@/db/*` under the
 * architecture lint) precisely so the *decision* is one isolated,
 * reviewable function; `repo.ts` AND-folds the returned `SQL` into its
 * WHERE clauses.
 */
export function visibleTripsPredicate(currentUserId: string): SQL {
  // Reference the parameter so the structured-for-per-viewer contract
  // is real (and so lint doesn't flag it unused). `true` keeps every
  // trip in scope under today's full-household-sharing model.
  void currentUserId;
  return sql`true`;
}
