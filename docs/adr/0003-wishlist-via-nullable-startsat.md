# ADR-0003: Activity wishlist via nullable `startsAt`

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** @SebboGit

## Context

Trips contain activities. Two states must coexist for the same trip:

- **Scheduled** — pinned to a specific date and time, lives in the chronological itinerary.
- **Wishlist** — "I want to do this on this trip, but I haven't decided which day yet." No date.

Both are first-class. The user can promote a wishlist item by assigning it a date, or demote a scheduled item by clearing the date.

Two storage shapes were on the table:

1. Single `segments` row, where `startsAt IS NULL` represents the wishlist state.
2. A separate `wishlist_items` table for undated intentions, distinct from `segments`.

### Forces

- **Itinerary query is the hot path.** Day-grouped chronological views run on every trip-detail page load. They join Documents and filter by trip, by date range, sometimes by country. Adding a second table would force a `UNION ALL` (or two parallel queries the UI must merge) on every Activities-tab render.
- **Promotion/demotion is a state change, not an entity migration.** Assigning a date to a wishlist item shouldn't move a row from one table to another — that breaks Document associations, breaks any future audit trail, and complicates `revalidatePath` semantics.
- **Discriminated-union guardrail.** `CLAUDE.md` already mandates one `segments` table with a `type` enum and JSONB `data`. Adding a sibling table for one substate of one type contradicts the established pattern.
- **Indexability.** "All scheduled segments in this trip, in order" is covered by `segments_trip_starts_idx (trip_id, starts_at)`. "All wishlist activities in this trip" is `WHERE trip_id = ? AND type = 'activity' AND starts_at IS NULL` — same index, NULL handled by btree.

## Decision

An `activity` segment with `startsAt IS NULL` **is** the wishlist state. No separate table. No new column. No status enum.

- The itinerary view filters `WHERE starts_at IS NOT NULL` (chronological).
- The Activities surface renders two sections: scheduled (`starts_at IS NOT NULL`, date-ordered) and wishlist (`starts_at IS NULL`).
- Promotion / demotion is a single-column UPDATE on `starts_at`.
- For non-`activity` types (`flight`, `hotel`, `transit`, `note`), a NULL `startsAt` retains its prior meaning: "date not yet specified" / TBD. The semantic is overloaded by segment type, not by table.

The overloading is documented inline on the schema (`src/db/schema/segments.ts`) so the next reader doesn't have to guess.

## Consequences

### Positive

- One table, one set of indexes, one repo, one validator module, one server-action surface.
- Promotion/demotion is `UPDATE segments SET starts_at = $1 WHERE id = $2` — atomic, preserves the row identity (and all Documents linked to it).
- Itinerary and Activities tab share the same data source — no `UNION` glue.
- Wishlist activities still get full Document attachment (e.g. ticket reservation PDFs filed against an undated intention).

### Negative / tradeoffs

- `startsAt IS NULL` has two meanings depending on `type`. A future reader who looks at the column alone won't know which. Mitigated by the inline comment and by repo functions named `listScheduled` / `listWishlist` that encode the per-type semantic.
- Queries that want "all scheduled segments regardless of type" must spell out `WHERE starts_at IS NOT NULL`; queries that want "the wishlist" must also filter `type = 'activity'`. Both are short and live in `src/lib/segments/repo.ts`, not at call sites.
- A non-activity segment with a NULL `startsAt` won't appear in chronological views. This is the existing behaviour, not a regression — TBD flights have always been invisible to chronological renders. The Flights tab (which is route-ordered, not date-ordered) will surface them.

### Neutral

- No migration burden. The column is already nullable.
- The choice does not preclude a future `wishlist_items` table if richer wishlist semantics (votes, collaborators, prioritisation) ever materialise — at that point we'd extract.

## Alternatives considered

- **Separate `wishlist_items` table.** Cleaner semantically: NULL means one thing, presence-in-table means another. Rejected because (a) it doubles the query surface for the most-rendered page in the app, (b) it breaks the discriminated-union guardrail without an offsetting query-pattern win, and (c) promotion becomes a delete-and-insert that loses row identity and complicates Document FK behaviour.
- **`status: 'scheduled' | 'wishlist'` column on `segments`.** Adds a column whose value is fully derivable from `startsAt`. Rejected as redundant — two sources of truth invite drift.
- **`scheduledFor: timestamptz | null` as a new column distinct from `startsAt`.** Same shape as the chosen design, but with two date columns where one was already doing the job. Rejected as duplication.

## References

- `src/db/schema/segments.ts` — inline comment documenting the per-type NULL semantic.
- ADR-0004 — the tabbed trip-detail IA that consumes this distinction.
- `CLAUDE.md` — segment discriminated-union guardrail.
