# ADR-0014: Floating local time for non-flight segment times

- **Status:** Accepted
- **Date:** 2026-06-03
- **Deciders:** @SebboGit

## Context

A trip segment carries a wall-clock time the user typed: an activity at
8pm, a dinner reservation at 19:30, a hotel check-in. Until now those
times were parsed in whatever timezone the code happened to run in — the
server's on submit, the viewer's on display — and the two are rarely the
same. Enter "20:00" while planning from Berlin and the value stored was
20:00 _Berlin_; render it from a phone in Tokyo and it shifted. It was
never "20:00 at the place," which is the only thing the user meant.

This first surfaced as a hydration mismatch: a non-flight card formatted
its time with no timezone, so the server (UTC) rendered `07:00` while the
browser rendered `09:00`, and React's hydration check failed. PR #69
(`29f5ed9`) shipped a deliberate **stopgap** — a client-only `LocalTime`
mount gate that rendered nothing until the browser took over — which
stopped the crash but locked in the wrong, viewer-relative display and a
flash of placeholder on every card.

Flights never had this problem. They format departure and arrival in the
origin/destination airport's IANA timezone (from the committed airport
snapshot, ADR-0009), so an SGN arrival reads the same `04:40` regardless
of where the server or viewer sits. The question this ADR settles is what
the _other_ segment types — activity, food, hotel, transit, note — should
do, given they have no airport and usually no resolved coordinates at the
moment a time is typed.

## Decision

Non-flight segment times are **floating local time**: the wall-clock the
user types is stored and displayed verbatim, with no timezone conversion
anywhere.

Mechanically this is "interpret the wall-clock at UTC on store, render it
in UTC on display." Because UTC is fixed, the result is deterministic on
both server and client, which lets us render times **server-side** again
and delete the `LocalTime` mount gate outright.

Concretely:

- **Storage.** The Zod `dateInput` (and the reschedule action's
  `scheduleInput`) interpret a no-timezone wall-clock string at UTC via a
  shared `wallClockToUtc` helper. `"2025-10-07T19:30"` becomes
  `2025-10-07T19:30:00Z`; a date-only `"2025-10-07"` becomes UTC midnight,
  which the cards read as "no time component." The flight path is
  untouched — flights still resolve their airport-tz instant before
  submit and arrive as a real `Date`.
- **Display.** Cards, the segment inspector, and the trip-map rail format
  non-flight times with `formatTime(d, { timeZone: 'UTC' })` on the
  server. Editing reads the stored instant's UTC wall-clock back into the
  form, so a value round-trips unchanged.
- **Day grouping.** Segments bucket by their **UTC calendar day** — the
  day the time reads — so grouping is identical on any server timezone
  (dev/prod parity). `dayKey` reads UTC; the bucket carries that token
  separately from its local-midnight display date, so the token and the
  rendered day label never disagree.
- **Unchanged, and correctly viewer-relative.** Which day is _today_, the
  "Today" marker, the collapsed-past split, and the home countdown still
  resolve in the viewer's zone and stay mount-gated. Those genuinely
  depend on the reader's clock; the stored wall-clock does not.
- **Flights** keep their airport-tz formatting (ADR-0009). Two time models
  now coexist by design: airport-anchored for flights, floating-UTC for
  everything else.

Existing data is **accepted as-is**, not migrated. Production runs in
UTC, so stored instants are already UTC wall-clocks; the dev fixture uses
explicit `Date.UTC(...)`. Both are already consistent under floating-UTC,
so a migration would be a no-op in practice.

## Consequences

### Positive

- A typed time shows back unchanged to every viewer, on every device —
  the bug is gone, not patched.
- Rendering is deterministic, so non-flight times render server-side with
  no hydration mismatch and no placeholder flash. `LocalTime` is deleted.
- Day grouping no longer depends on the server's timezone, closing a
  dev/prod skew.

### Negative / tradeoffs

- A floating time is not anchored to a real place, so cross-timezone
  conversion ("show this Tokyo dinner in my home zone") is impossible by
  construction. For a personal planner that's the right trade — the time
  on the card is the time at the place, which is what was meant.
- The codebase now carries two time models. The boundary is clear (flight
  vs. everything else) but it is a thing a future reader must learn.
- "Floating local" is implemented as UTC wall-clock, which can mislead if
  read literally — a 19:30 dinner is stored `19:30Z` but is not a claim
  about UTC. The helpers and this ADR are the explanation.

### Neutral

- A `NULL` startsAt stays overloaded per type (an undated activity/food
  candidate vs. "date TBD" elsewhere) — unchanged from ADR-0003.
- A late-evening flight can group onto a different UTC day than its
  airport-local day. This already happened under the previous UTC-server
  behaviour; it is not a regression and is rare enough to leave.

## Alternatives considered

- **Derive a real IANA timezone from coordinates.** Map each segment's
  geocoded lat/lng to a timezone via a committed tz-polygon snapshot
  (mirroring the airport→tz table), so a Tokyo activity reads "20:00 JST"
  and could be converted. Rejected: it needs the dataset, a no-coordinates
  fallback, and a worse entry flow (the time is usually typed before the
  place is geocoded). Overkill for a single-household planner — revisit
  only if cross-timezone display becomes a real need.
- **Keep viewer-relative display (status quo + the #69 stopgap).**
  Rejected: it is wrong by design — the same segment shows different times
  to different viewers, and to the same viewer after they travel.

## References

- Issue #70 — the bug report and the floating-vs-coordinate framing.
- PR #69 (`29f5ed9`) — the `LocalTime` mount-gate stopgap this supersedes.
- ADR-0003 — undated activities via nullable `startsAt` (the "wishlist"
  name for that state is retired from the UI here; "wishlist" now refers
  only to the household reusable-place list).
- ADR-0009 — flight times from the airport snapshot, the airport-anchored
  model floating-UTC sits alongside.

Shipped alongside two UI changes that lean on the corrected times: the
Activities tab flattens to a single dated-and-undated list (matching the
Food tab — the itinerary is the trip's one chronological view), and the
quick reschedule affordance extends to food with type-aware date+time.
