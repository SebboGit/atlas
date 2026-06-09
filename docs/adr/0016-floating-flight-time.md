# ADR-0016: Floating local time for flight segment times

- **Status:** Accepted
- **Date:** 2026-06-09
- **Deciders:** @SebboGit
- **Supersedes:** the flight-airport-tz clause of ADR-0014 — flights no
  longer convert into the airport zone, and the two-time-model split is
  collapsed into one.

## Context

ADR-0014 made every non-flight segment time _floating local_: store the
typed wall clock interpreted at UTC, display it in UTC, bucket the
itinerary by UTC calendar day. It deliberately kept flights on a second
model — store a real absolute instant, display it converted into the
origin/destination airport's IANA zone (ADR-0009) — and called the two
models coexisting "by design."

A document-extraction bug exposed why that split doesn't hold. Boarding
passes print local wall-clock times with no offset (e.g. `18:05`). The
extraction mapper parsed them with `new Date()`, which anchors a naive
datetime in the _server's_ zone (UTC in prod). The flight card then
converted that instant into the airport zone — double-counting the
offset, so an 18:05 CEST departure displayed as 20:05.

The obvious fix — anchor the naive time in the airport's zone at storage
so the conversion round-trips — corrects the displayed time but breaks
the day. The itinerary buckets _every_ segment by its UTC calendar day
(`dayKey`), which is sound only because everything is floating-UTC. A
true airport-local instant crosses the UTC boundary whenever the local
time sits within the airport's offset of midnight: a 06:00 Tokyo (UTC+9)
departure is 21:00Z the previous day and buckets onto the wrong day.
Morning departures from positive-offset airports are common, not a corner
case.

So a single `timestamptz` cannot give both the correct displayed local
time and the correct UTC-bucketed day for a boundary-crossing flight —
unless flights stop being the exception. And nothing actually needs the
absolute instant: the home countdown is computed from the trip's start
date at day granularity, and push reminders (which would need a real
instant) are unbuilt.

## Decision

Flight segment times become **floating local**, exactly like every other
segment type. The wall clock the boarding pass prints is stored
interpreted at UTC and displayed verbatim in UTC; the origin/destination
airport supplies only a **zone label** (`06:00 JST`) at render time,
derived from the committed airport→IANA snapshot — never a clock
conversion.

Concretely:

- **Storage.** The extraction mapper and the manual flight form both
  store the printed wall clock through the shared floating parse. A
  printed offset, if any (a pkpass `relevantDate`), is dropped — the
  airport IATA carries the zone. A bare flight date lands on UTC
  midnight, the "no time component" sentinel.
- **Display.** The flight card and the segment inspector render the
  stored instant with `formatTime(d, { timeZone: 'UTC' })` and tag it
  with `zoneAbbreviation(d, airportTz)`. `hasTimeComponent` and the
  overnight `+1` indicator read UTC. No site converts a flight time into
  the airport zone anymore.
- **Day grouping.** Unchanged — flights now bucket by their printed local
  day under the existing UTC `dayKey`, because the stored UTC wall clock
  _is_ the printed day.
- The two-model split from ADR-0014 is gone: one floating-UTC model for
  every segment type.

Existing data is **accepted as-is**, not migrated (matching ADR-0014).
Production runs in UTC, so naive flight times already stored as UTC
wall-clocks are already correct; re-extracting a document corrects the
rare row whose time came from an offset-bearing source.

## Consequences

### Positive

- The extraction time bug is fixed, and — unlike airport-anchoring — the
  itinerary day stays correct for boundary-crossing flights.
- One time model for every segment type. The "flight vs. everything else"
  split a future reader had to learn (ADR-0014's own noted negative) is
  removed.
- Flight times render server-side, deterministic, with no conversion.

### Negative / tradeoffs

- A flight time is no longer a true absolute instant. A sub-day "time
  until this flight" or a precise push reminder would be off by the
  airport's offset. Acceptable: nothing consumes it today, and when
  reminders are built the instant can be recomputed on demand from the
  stored wall clock plus the airport's IANA zone.
- A genuine 00:00 airport-local departure collides with the date-only
  sentinel and renders without a time — the same rare, documented
  tradeoff floating already carries for every type.
- The zone label is derived from the floating instant, so its DST
  abbreviation (CET vs. CEST) can be wrong inside the few-hour window
  around a transition. Cosmetic.

### Neutral

- ADR-0014's note that "a late-evening flight can group onto a different
  UTC day than its airport-local day" is now resolved for the common case
  rather than left standing — floating flights group on the printed day.

## Alternatives considered

- **True instant + zone-aware bucketing.** Keep flights as absolute
  instants and make `dayKey` bucket flights by their origin-airport zone.
  Rejected: it touches the itinerary bucketing backbone and every
  `dayKey` consumer (the timeline rail, collapsed-past split, chrono
  map), and mixes two bucketing models (flights zone-bucketed, everything
  else UTC) — more surface and risk to preserve an absolute instant
  nothing uses.
- **Mandatory flight time.** Require a time so the date-only sentinel
  never collides. Rejected: extraction and manual entry both legitimately
  yield date-only flights, so it would reject real boarding passes or
  invent a time — and it does not address the day-bucketing conflict at
  all.

## References

- ADR-0014 — floating local time for non-flight segments; this ADR
  extends that model to flights and supersedes its airport-tz clause.
- ADR-0009 — the committed airport→IANA snapshot, now used for the zone
  _label_ only, not for conversion.
