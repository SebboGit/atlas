# ADR-0009: Drop flight-metadata lookup; LLM extracts times + static airline-name table

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** @SebboGit
- **Supersedes:** ADR-0007

## Context

ADR-0007 picked AviationStack's free tier (100 req/mo) as the runtime flight-metadata source: a server action would call the provider on form-field blur or during document extraction, returning carrier/route/scheduled times. The infrastructure to support this (provider client, DB-backed cache, single-flight coalescing, schema, migration) was already built but never wired.

A pre-implementation probe with a real API key revealed a free-tier change since ADR-0007 was written: **AviationStack's `/flights?flight_date=…` query now returns `403 function_access_restricted`**. Other parameter combinations (no filter, `flight_iata` alone, `airline_iata` alone) still work, but only against today/tomorrow's scheduled data. The "give me BA287 on 2026-09-20" pattern that the feature was designed around is now a paid endpoint.

The realistic options were:

1. Pay for the feature ($49.99/mo+) on a single-user personal app. No.
2. Re-shape the integration around real-time-only data (today+1 day window). Most flights people enter into Atlas are weeks out, so the lookup would mostly return `null` — a feature that misses half the time feels broken.
3. Switch to AeroAPI (500 free calls/mo for real flight schedules), accept a new signup and sliding cost cliff, port the provider client.
4. Drop the live-lookup capability entirely and lean on what we already do well: Ollama already reads boarding-pass and confirmation documents; it can extract scheduled times the same way it extracts everything else.

The user has either the document (boarding pass, e-ticket, confirmation email) or they're entering manually. If they have the document, Ollama can pull the times out. If they don't, they probably also don't know the exact scheduled times — manual entry is the only honest path either way. The carrier-name part of the live-lookup motivation (turn "VN" into "Vietnam Airlines") doesn't need a live API at all; airline IATA assignments change rarely and a snapshot table covers the case.

## Decision

**Remove the AviationStack integration entirely. Use Ollama for in-document scheduled times. Use a static IATA-to-name table for airline display.**

Concretely:

1. **Delete the AviationStack code.** `aviationstack.ts`, `flight-cache.ts`, the `FlightMetadataProvider` interface, the `flight_metadata_cache` Postgres table (forward-only DROP migration), and the `AVIATIONSTACK_API_KEY` env var.
2. **Extend the LLM extraction schema.** `BoardingPassPayload` gains `scheduledDeparture` and `scheduledArrival` as nullable ISO-8601 strings; the prompt asks the model to populate them only when the document prints a time, with explicit examples covering with- and without-timezone forms. The pkpass direct extractor surfaces the pass's `relevantDate` as `scheduledDeparture`.
3. **Use the times.** The payload→segment mapper (`from-payload.ts`) prefers `scheduledDeparture` over `flightDate` for `startsAt` and lifts `scheduledArrival` to `endsAt`; existing date-only behavior is preserved as a fallback.
4. **Airline-name lookup is static.** A committed JSON snapshot from OpenFlights (~970 active carriers with 2-letter IATA designators), accessed through `displayCarrier()` (UI helper that resolves IATA-shaped values, passes everything else through) and `getAirlineName()` (strict lookup). The mapper applies the lookup at extraction time so the segment stores the friendly name; flight cards also run `displayCarrier()` so legacy rows that still hold a bare code render readably without a data migration. The refresh script is `scripts/fetch-airlines.ts`, run rarely.

## Consequences

### Positive

- **No runtime external dependency** for the flight path. The OpenFlights snapshot is shipped in the repo; the rest is the LLM that we already run locally.
- **No quota anxiety.** No way to accidentally burn a 100/mo budget with a test session or a runaway retry loop.
- **One source of times.** A boarding pass that prints "Departure 14:30 LHR" surfaces as a 14:30 startsAt directly; we don't have to reconcile what the document says with what the schedule API says.
- **Privacy story is purer.** Document content was already local-only via Ollama; now there is genuinely zero outbound network traffic in the extraction hot path. The static-data refresh script is the only external touch, and it's manual + rare.

### Negative / tradeoffs

- **No live status, ever, here.** This ADR explicitly does not cover delay / gate / cancellation updates. If we want that, it's a separate `FlightStatusProvider` behind a paid provider — keep the interface separate from extraction.
- **Manual flight entry stays manual.** ADR-0007 envisioned auto-fill on form blur for hand-entered flights with no document. That goes away. The user types whatever they type; the airline name lookup runs on the IATA prefix if they happen to enter one, but no schedule pre-fill.
- **The static airline table will drift.** A carrier that changes its IATA code, or a new one we haven't snapshotted, will render as the bare code. Acceptable: the refresh script is one command.
- **LLM accuracy is the new ceiling for times.** If the model misreads "14:30" off a stylised boarding pass, the segment lands on the wrong minute. Same risk profile as every other field the LLM extracts; existing review-then-confirm UX (and the ParsedEditDialog) covers the fix path.
- **Wasted build work.** The provider client + cache wrapper + 200-line test suite were thrown away. That work taught us the right shape for a future provider integration (interface, DB cache, graceful degradation, no retries) — those principles live on in the "External Integrations" section of CLAUDE.md.

### Neutral

- **Dedup matches across carrier-name and IATA-code storage.** Post-review fix: `findFlightByKey` expands the supplied carrier via `equivalentCarrierForms`, so a query for "British Airways" matches segments stored as either "BA" or "British Airways" (and vice versa). The two storage forms coexist quietly until a refresh of the underlying data.
- **Date-form dedup miss is known.** When one side of the comparator is a real ISO instant from `scheduledDeparture` (e.g. `2026-06-01T11:30:00Z`) and the other is local midnight (legacy or `flightDate`-only), dedup silently misses even though both represent the same wall-clock day. The clean fix is a global "store dates as wall-clock day, not timestamptz" change — out of scope for this ADR. Pinned by an explicit negative test in `src/lib/segments/repo.test.ts`. In practice the dedup case ("same flight, two travellers") usually means "same extraction path on both documents", so cross-form misses are rare.
- The future "live flight status" capability, when/if it lands, picks its own provider and writes its own ADR. It does not reuse this path.

## Deferred / open questions

These are explicitly **not** in scope for this ADR but are likely to come up. Naming them here so the next person doesn't have to re-derive them.

- **Form-time airline auto-fill on IATA blur.** When a user manually types `"VN"` into the Carrier field of the segment form, we could run `displayCarrier` on blur and update the field to `"Vietnam Airlines"` — a pure-local, zero-network enhancement entirely consistent with the new architecture. Skipped here because the user's "manual stays manual" framing was explicit; revisit if friction surfaces in real use.
- **Live flight status (delays, gate changes, cancellations).** Distinct from the schedule-pre-fill capability we just dropped. Requires a paid provider (AeroAPI is the held-in-reserve choice from ADR-0007's alternatives) and its own data lifecycle. Would land behind its own `FlightStatusProvider` interface; do **not** revive the deleted `FlightMetadataProvider` abstraction.
- **Wall-clock-day dedup across `scheduledDeparture` vs `flightDate` storage.** Documented under Consequences. The clean fix is "store dates as date-only, not timestamptz" — a broader refactor that affects every segment type. Worth doing eventually; not driven by today's pain.
- **A periodic refresh of the airline snapshot.** Currently manual. If we ever want it on cadence, the `scripts/fetch-airlines.ts` shape is already the right one — wire it into a GitHub Action quarterly, commit-on-change. Skipped because airlines change slowly enough that drift hasn't surfaced.

## Alternatives considered

- **B — AeroAPI Personal tier.** 500 calls/mo free, then $0.04/call. Better data than AviationStack, but a sliding cost cliff and a new signup. Held in reserve; can be picked back up under a future ADR if a real product need (e.g., live status, or "I'm entering a flight three weeks out and want the times pre-filled") emerges.
- **A2 — Reshape around AviationStack real-time only.** Drop `flight_date`, filter the multi-row response client-side by date, expect most lookups to miss because the dataset only covers today+tomorrow. Rejected: a feature that returns `null` more often than not is a UX hazard.
- **Hand-curated airline table.** ~200 top carriers, hand-written. Rejected as too small — uncommon carriers on real boarding passes (regional ops, intra-Asia, charter) would miss. OpenFlights at ~970 entries covers materially more without much extra cost.

## References

- ADR-0006 — Ollama (local-only) for LLM extraction. The bigger LLM commitment this ADR leans on.
- ADR-0007 — AviationStack flight metadata lookup. Superseded.
- ADR-0008 — Document → segment auto-create. The downstream consumer of the LLM payload; updated cross-reference.
- `src/lib/airlines/` — the static lookup module.
- `scripts/fetch-airlines.ts` — refresh procedure.
- [OpenFlights data](https://github.com/jpatokal/openflights) — source of the airline snapshot (CC-BY-SA 3.0).
