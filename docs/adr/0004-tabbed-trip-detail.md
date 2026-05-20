# ADR-0004: Tabbed trip detail with path-segment routing

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** @SebboGit

## Context

The trip detail page is the most-visited surface in Atlas. The initial sketch put everything on one route: header, summary, day-grouped itinerary inline, with the implicit assumption that scrolling is fine.

That collapses on a real trip. A two-week trip with dense activities can run to dozens of segments. The user's specific pain: "finding the next hotel takes too much scrolling." Documents have the same problem — they live nested under their parent segment in the itinerary view, but the user often wants "show me every doc on this trip" without hunting.

A third concern: activities have two coexisting states (scheduled and wishlist; see ADR-0003). The chronological itinerary can't represent the wishlist meaningfully because wishlist items have no chronology.

Two candidate IAs:

1. **Filter chips on the itinerary.** Single route, chip row toggles `type = flight | hotel | activity | …`. Same component, filtered data.
2. **Tabbed shell.** Distinct routes for each surface, each reshaping the data for its purpose.

### Forces

- **Type-specific views earn their keep by _reshaping_, not just filtering.** A flight list ordered by departure with route prominent is structurally different from a chronological day-grouped card. A hotel list ordered by check-in with nights and price is different again. Filters can't reshape — they only hide rows.
- **Activities cannot be a filter.** The wishlist has no date; a chronological view filtered to activities still wouldn't show wishlist items. The Activities surface needs its own structure.
- **Deep-linkability.** The user (and future shared-link feature) benefits from `/trips/:id/hotels` being a real URL: bookmarkable, back-button-friendly, copyable in a message.
- **RSC data loading per tab.** Each tab fetches its own narrow query (flights only, hotels only, country-filtered) rather than the itinerary's wide fetch. Smaller payloads, simpler `loading.tsx` boundaries.
- **Country filter is orthogonal to tab.** It's "the same query, narrowed" — naturally a search param, not a route.

## Decision

The trip detail page is a **tabbed shell** rooted at `/trips/:id/`, with five path-segment tabs and one search-param filter.

### Routes

- `/trips/:id` → server `redirect('/trips/:id/itinerary')`.
- `/trips/:id/itinerary` — day-grouped chronological view. Default landing tab.
- `/trips/:id/flights` — flight list, departure-ordered, route-focused. Hero card for the next upcoming flight when the trip is active.
- `/trips/:id/hotels` — stay list, check-in-ordered.
- `/trips/:id/activities` — dual-state surface. Scheduled (date-ordered) above Wishlist (card grid). See ADR-0003.
- `/trips/:id/documents` — all documents on this trip, including unattached / trip-level docs. Filter chips for type, linked-to, review status.

### Shared layout

`/trips/:id/layout.tsx` (RSC) loads the trip once and renders:

- Header (back chip, eyebrow, title, date strip, edit/archive/delete actions).
- `<TripFilterBar />` — country chip group, **rendered only when the trip has ≥2 countries**.
- `<TripTabs />` — client component, uses `usePathname` to highlight the active tab, navigates via `<Link>` so the country search param is preserved across tab switches.

The trip is fetched once in the layout; each tab's `page.tsx` is responsible only for its own data.

### Country filter

`?country=DE` — sticky across tab switches via `<Link>` (Next preserves search params under a shared layout). Updates use `router.replace`, not push — tweaking a filter should not pollute history. Tab navigation uses push — the user reasonably expects "back" to return to the previous tab.

### Responsive shape

- **Laptop (≥1024px):** horizontal tab strip beneath the header, left-aligned. Itinerary uses a left timeline rail (~120px gutter). Activities renders scheduled and wishlist side-by-side on `xl:` and above.
- **Mobile (360px):** the same tab strip becomes a horizontally scrollable segmented control under a sticky header. Five items fit on a 360px scroll; no hamburger. Itinerary drops the rail. Activities stacks scheduled then wishlist. Touch targets ≥44px throughout.

## Consequences

### Positive

- Each tab is a real URL — deep-linkable, bookmarkable, back-button-correct.
- Each tab can have its own `loading.tsx` and `error.tsx` without affecting the others, because they're sibling routes under a shared layout.
- The data fetch for each tab is narrow (a `WHERE type = ?` clause, not a full trip load), keeping payloads small.
- The country filter is a single source of truth at the URL level — copying a link copies the filter state.
- IA is extensible: a future Map tab, Expenses tab, or Calendar tab is an additive route, not a refactor.

### Negative / tradeoffs

- Five tabs is the upper end of what mobile can carry without overflow. A sixth would force a "More" menu or a vertical mobile nav. Today: five.
- Tab navigation is a client-side route transition, not a section scroll. A user who wants to glance across tabs without losing context has to navigate. Mitigated by `<Link prefetch>` keeping perceived latency near zero.
- Trip-level header re-renders are governed by the shared layout, not per-tab. A future change that varies the header per tab would need an in-page slot or a `parallel route`.

### Neutral

- The choice does not preclude a future "All segments" filter view living at `/trips/:id` itself if that becomes valuable; the current redirect can become an actual page.

## Alternatives considered

- **Single page with filter chips.** Rejected: filters can hide but cannot reshape; the type-specific views actively benefit from layouts different from the itinerary's chronological card. Filters also can't represent the wishlist state at all.
- **`?view=flights` instead of path segments.** Search-param routing would work but loses Next's per-route `loading.tsx` / `error.tsx` boundaries, makes prefetch less natural, and conflates "which surface" (a navigational decision) with "how is it filtered" (a parameter decision). Reserved search params for filters.
- **Sidebar nav instead of top tabs.** Works on laptop, awkward on mobile, and steals horizontal space the itinerary's two-column header already uses. Top tabs read as "I'm inside one trip, looking at one of its faces"; a sidebar reads as "I'm in a different section of the app."

## References

- ADR-0003 — activity wishlist via nullable `startsAt` (consumed by the Activities tab).
- ADR-0005 — per-segment country attribution (consumed by the country filter).
- `CLAUDE.md` — responsive design rules (laptop + mobile both look intentional).
