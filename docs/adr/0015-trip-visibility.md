# ADR-0015: Per-trip visibility (household | private)

- **Status:** Accepted
- **Date:** 2026-06-03
- **Deciders:** @SebboGit

## Context

Atlas is built for a small household — roughly two people signing in with
separate PocketID identities. Until now the model was _full household
sharing by default_: every aggregate carried a `userId` column that meant
"who created this," not "who owns it," and nothing in the read path
filtered by the viewer. ADR-0002, the wishlist schema, and the search
action (ADR-0013) all encode that stance.

In practice the implementation had drifted. The wishlist and the stats
dashboard were genuinely household-shared, but the trip repo
(`listForUser` / `getByIdForUser`) and every segment / document / map read
filtered by `eq(trips.userId, viewer)` — i.e. trips were _owner-scoped_.
With one user the contradiction is invisible; the moment a second member
signs in it surfaces as an empty trip list and a 404 on the partner's
trips while the stats page still counts them.

Separately, there was no way to keep a trip off the shared view at all.
The household wants the _option_ to mark a trip private (a surprise, a
solo trip) without an `ownerships` join table or SaaS-grade tenancy.

## Decision

Add a `trips.visibility` enum (`household` | `private`), defaulting to
`household`, and make it the **single visibility boundary** for the app.

- **One predicate, one home.** `tripVisibleToViewer(viewerId)` lives in
  `src/lib/trips/repo.ts` and returns
  `visibility = 'household' OR userId = viewerId`. Every content read and
  every content write folds it in — trips, segments, the per-trip map, the
  visited-country roll-up, stats, and search. The predicate is defined
  exactly once so the security rule can't drift between call sites.
- **Reads = access; content writes = access.** A household member sees,
  and can edit/add/delete the segments of, any household trip. This is the
  "shared planning surface" the household wants. Materialising a wishlist
  pick onto a trip follows the same gate.
- **Trip-row mutations stay owner-only.** Rename, dates, status, archive,
  delete, **and the visibility setting itself** keep the strict
  `eq(trips.userId, viewer)` check. The creator owns the container even
  when its contents are shared; `private` is defined relative to the
  creator, so only the creator can flip it.
- **Documents stay uploader-scoped.** A document carries a real name /
  passport, and the extraction pipeline (claims, re-extract races) is
  keyed on `documents.userId`. Sharing documents across the household is a
  heavier, separate decision, so this ADR leaves the document subsystem
  owner-scoped: a co-member sees a shared trip's segments but not its
  uploaded files. No leak either way (more private, not less). Search is
  tightened to match — a viewer only finds their own documents.
- **Manual visited-country marks stay personal.** "Places I'd been before
  Atlas" is a per-user overlay; only the trip-derived half of the
  visited-country roll-up respects trip visibility.
- **Backfill to household.** The migration adds the column with
  `DEFAULT 'household' NOT NULL`, so every existing trip becomes shared —
  matching the documented intent.

## Consequences

### Positive

- The household model is now real and consistent end to end: a second
  member sees shared trips, their stats, their map, and their search hits,
  and can co-plan segments — while either member can keep a trip private.
- The security boundary is one reviewable function. Adding a new
  cross-trip read means importing `tripVisibleToViewer`, not re-deriving
  the rule.
- Per-request isolation already holds (DB-backed sessions, request-scoped
  `cache()`, userId threaded into every query), so concurrent members get
  independent views with no new machinery.

### Negative / tradeoffs

- Asymmetry: a co-member can add **segments** to a shared trip but cannot
  **upload documents** to it (uploads stay owner-scoped). Defensible, but
  worth a follow-up if household document sharing is wanted.
- Integration tests that relied on per-user isolation for _test_ isolation
  had to switch to membership-based assertions, because household trips
  are now globally visible on a shared DB.
- The `visibility` enum is intentionally binary. A third tier (e.g.
  per-member ACLs) would need a real join table and a new ADR.

### Neutral

- `trips.userId` keeps its dual meaning: provenance for reads, ownership
  for trip-row mutations and the `private` branch.
- No index was added for `visibility` (two-valued, personal-app scale).

## Alternatives considered

- **An `ownerships` / `trip_members` join table.** Rejected — SaaS-grade
  tenancy for a two-person household. The extension point in CLAUDE.md
  explicitly pre-committed to the enum instead.
- **Keep full sharing, fix only the inconsistency.** Rejected — the
  household explicitly wanted the _option_ to make a trip private.
- **Share documents across household trips in this change.** Deferred —
  exposing boarding-pass files is a heavier privacy step and drags in the
  extraction concurrency machinery. Defaulting to the more-private option
  needs no decision from the user.

## References

- ADR-0002 (PocketID auth, DB-backed sessions), ADR-0005 (per-segment
  country attribution), ADR-0013 (search gating)
- CLAUDE.md → Extension Points → "Household sharing visibility"
- `src/lib/trips/repo.ts` (`tripVisibleToViewer`)
