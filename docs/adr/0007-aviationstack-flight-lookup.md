# ADR-0007: AviationStack (free tier) for flight metadata lookup

- **Status:** Superseded by [ADR-0009](./0009-drop-flight-metadata-lookup.md)
- **Date:** 2026-05-15
- **Deciders:** @SebboGit

> **Superseded same day.** A pre-implementation probe revealed AviationStack's free tier no longer accepts the `flight_date` parameter on `/flights` (returns `403 function_access_restricted`). The lookup we wanted is now paid-only. Rather than pay for the feature or compromise on the spec, we dropped the capability entirely. See ADR-0009 for the new shape: Ollama extracts scheduled times directly from documents, and a static IATA→airline-name table covers the friendly-name display. The original analysis below is preserved for reference.

## Context

Atlas's flight segment form is a manual entry path (origin, destination, scheduled times, airline, flight number, confirmation code). Two product realities make this tedious:

1. Most of those fields are derivable from `(carrier, flightNumber, scheduledDate)`.
2. Some flights are entered manually without a document at all — there's no boarding pass PDF to OCR, so the extraction pipeline can't help.

The right shape is to surface enrichment as a server action triggered on field blur (once both flight number and date are present), so manual entry and document-driven entry share the same fill-in muscles.

We need a provider that:

- Returns airline, IATA codes (origin/destination), scheduled departure/arrival times.
- Has a usable free tier — this is a personal app, not a SaaS, and we don't want a $50/mo bill for occasional auto-fill.
- Can be wrapped behind an interface so the choice is reversible.

## Decision

Use **AviationStack** on the **free tier (100 requests/month)** as the initial flight metadata provider.

- Implementation: `src/lib/extraction/aviationstack.ts` behind a `FlightMetadataProvider` interface in the same directory.
- Auth: `AVIATIONSTACK_API_KEY` env var.
- **Caching is mandatory.** All lookups go through a DB-backed cache table keyed on `(carrier, flightNumber, scheduledDate)`, TTL 24 hours. The provider is only hit on a cache miss.
- **Triggering is explicit.** Lookups fire on form-field blur once both flight number and date are filled in. Never on keystroke, never on page load, never as a background sweep.
- **Graceful degradation.** A failure (network error, rate limit, missing key, quota exhausted) returns `null` and lets the user submit the form with whatever they typed. The error is logged structured; the form does not block.
- **No retries.** Rate limits do not improve with retries; we just degrade and move on.

## Consequences

### Positive

- **Zero ongoing cost** at expected usage. A few flights per month per user fits comfortably inside 100 requests.
- **Real schedules.** The user gets the actual airline-published times for the date in question, not "approximately."
- **Shared with extraction.** When the document-ingestion path is built, it calls the same `FlightMetadataProvider` to enrich whatever OCR produced.

### Negative / tradeoffs

- **Tight rate budget.** 100 req/mo is not a lot. Caching keeps us well under, but a buggy retry loop or a curious test session can burn through it fast. Operational discipline matters.
- **Data quality variability.** Free-tier APIs have less guaranteed freshness than paid endpoints. Sufficient for "fill the form so the user can correct it" — not sufficient for live status.
- **Single point of failure.** If AviationStack changes terms, breaks, or shuts down, the auto-fill stops working. Manual entry still works — by design.

### Neutral

- This ADR explicitly does **not** cover live flight status (delays, gate changes, cancellations). That's a separate capability with different SLAs and almost certainly a paid provider. Keep it behind its own `FlightStatusProvider` interface when it lands.
- Hotel metadata lookup is not decided. When it lands, follow this same shape: interface, single implementation, DB-backed cache, graceful degradation.

## Alternatives considered

- **AeroAPI (FlightAware) Personal tier.** 500 free calls/month, then $0.04/call. More headroom and probably better data, but a sliding cost cliff and a more involved sign-up. Realistic alternative if AviationStack proves insufficient — a one-file swap.
- **OpenSky Network.** Free and open, but the data model is live-track focused, not "scheduled flight by number and date." Wrong shape for this use case.
- **No auto-fill.** Acceptable as a starting point but leaves manual entry tedious forever. We're committing to the interface today even if the implementation is minimal.

## Operating rules

These are non-negotiable for the AviationStack integration and are enforced in the code, not just in this ADR:

1. Every call goes through the DB cache. No direct provider calls from feature code.
2. The provider client refuses to fire if `AVIATIONSTACK_API_KEY` is unset — it returns `null` and logs a one-line warning, never throws.
3. Cache rows are written even on negative results (the API said "no such flight"), with a shorter TTL, to avoid burning quota on the same miss.
4. The provider's full response is **not** logged. Only the resolved fields used by the form, and never on success at `info` level.

## References

- ADR-0006 — Ollama (local-only) for LLM extraction (sibling decision about the structuring layer).
- [AviationStack pricing](https://aviationstack.com/product)
- [AeroAPI pricing](https://flightaware.com/commercial/aeroapi/) — kept as alternative reference.
