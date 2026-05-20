# ADR-0008: Auto-create and link segments on document extraction

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** @SebboGit

## Context

Today the document pipeline stops one step short of being useful. A user uploads a boarding pass, hits **Extract**, and the structured payload lands in `Document.parsed` — and nothing else happens. The corresponding flight does **not** appear on the itinerary; the document is **not** linked to a segment; the FK `documents.segment_id` (`src/db/schema/documents.ts:63`) exists but is never populated.

That gap is the difference between "I parsed your boarding pass" and "I added your flight." Closing it is what makes Atlas worth using.

Two product realities shape the decision:

1. **Manual entry must still work.** Users add segments from the form without ever uploading anything. The auto-create path can never become the only way to get a flight onto the itinerary.
2. **Trip dates are soft.** Per ADR-0003, trips can have null start/end (wishlist). Even when set, the dates the user typed in are approximate — an overnight flight to Tokyo on the trip's "first day" usually _departs_ the day before, and a returning red-eye lands the day after. Hard rejection on a date mismatch would force users to edit the trip just to add a real document, which is a worse UX than the gap we're trying to close.

Two trigger points were considered: auto-create **on upload**, or auto-create **on manual extraction**. The on-upload path drags the LLM into the synchronous upload latency and creates a new failure mode (upload succeeds but secretly fails to add a flight). The on-extraction path keeps the user in control — they see a Document card, click Extract, and the segment appears as a visible result of that explicit action.

## Decision

After a successful manual extraction (via the existing Extract button in `document-extract-button.tsx`), the action:

1. Persists the structured payload (already happens).
2. **Creates a segment** from the payload via a payload→segment mapper.
3. **Links** the new segment back onto the document by populating `documents.segment_id`.
4. Applies a **soft date check** against the trip window and tags the segment with an advisory flag (not a rejection) when the dates fall outside tolerance.

Mechanism — inside `extractDocumentAction` (`src/lib/documents/actions.ts:103`):

- Map `StructuredPayload` → `SegmentCreateInput`:
  - `boarding-pass` → `flight` segment. Fields lift directly: `carrier`, `flightNumber`, `originAirport`, `destinationAirport`, `flightDate` → `startsAt` (local midnight, matching `validators.ts:36` date-only handling). **`passengerName` is NOT lifted onto the segment** — see "Passenger-name privacy" below.
  - `hotel-confirmation` → `hotel` segment. `checkIn` → `startsAt`, `checkOut` → `endsAt`, `hotelName` → `propertyName`, `country` → `countryCode`.
  - `generic` → **no segment**. The document keeps its parsed payload; no segment is created.
- **Match-or-create** against the trip's existing segments before inserting (see "Boarding-pass deduplication" below). On match, link the document to the existing segment; on miss, create a new one.
- Call the existing `segments.create` repo function with the mapped input and the trip's `userId` + `tripId` only when no matching segment was found.
- Write the resulting segment id onto the document via a single transaction-safe path (extend `recordExtraction` to accept `segmentId`, or call a new `linkSegment` repo method — implementer's choice; both end up in the same DB write).
- **Idempotency:** if `Document.segmentId` is already populated on re-extract, do **not** create a duplicate. The repo's responsibility — re-running Extract on the same document is a no-op for segment creation. Updating the existing segment from re-extracted data is out of scope here; user can edit the segment directly.

**Boarding-pass deduplication (many-documents → one-segment):**

A common real-world case: the user uploads a boarding pass for each traveller on the same flight — same carrier, same flight number, same date, but a different passenger name and PNR on each PDF. The pipeline MUST recognise these as the same flight and create exactly **one** segment, with every document linked to it.

- **Match key:** `(carrier, flightNumber, flightDate)` on the same `tripId`, case-normalised (`carrier` and `flightNumber` upper-cased, `flightDate` as ISO YYYY-MM-DD).
- **Match policy:** if any of the three components is `null` in the extracted payload, match conservatively — do not dedupe blind. Better to create a stub segment the user can clean up than to merge two unrelated flights.
- **Behaviour on match:** populate `Document.segmentId` with the existing segment's id; do not touch the segment row. Multiple `documents.segment_id` already pointing at the same segment is what we want — that's how "this segment has 3 boarding passes attached" surfaces in the UI.
- **Behaviour on miss:** create the segment via `segments.create` as usual, then link.
- **Race window:** two extractions of "different boarding passes for the same flight" can complete near-simultaneously and both hit "miss" at lookup time. Acceptable trade-off for now; the user can merge with a manual click. If this becomes a real problem, add a unique index on `(trip_id, segment_type, data->>'carrier', data->>'flightNumber', data->>'flightDate')` filtered to flight rows and rely on `ON CONFLICT DO NOTHING` to collapse.
- Hotel-confirmation and other types are NOT deduplicated by this mechanism — only `boarding-pass`. A second hotel-confirmation for the same property on overlapping dates is more likely a real second booking than a duplicate.

**Passenger-name privacy:**

The extracted `passengerName` lives on the `Document` row inside `parsed`, where it's visible on the Documents tab as a secondary line ("Passenger: DOE/JANE"). It is the canonical place to see who a specific boarding pass belongs to — useful in the family-of-travellers case above.

- **Do NOT copy `passengerName` onto the segment.** The flight segment represents the trip event (the flight itself), not a particular traveller. When the segment is rendered on the Itinerary tab, the Flights tab, or any future shared view, no passenger name appears.
- The passenger names of the linked documents are derivable by joining `segment.id → documents.segment_id → documents.parsed.passengerName`. If a future feature wants "who's on this flight?" it can compute that view on demand; the segment itself remains traveller-agnostic.
- This is a privacy posture decision, not a data-loss decision. Names stay associated with their source documents; they just don't bleed onto the shared segment surface.

**Soft date check:**

- Tolerance window: **±2 days** around the trip's `startDate` and `endDate`. A flight scheduled for the day before, the day of, or up to 2 days before the trip start is considered "in window." Symmetric on the end side. If either trip date is null (wishlist), the date check is skipped entirely.
- Outside the window: the segment is **still created and linked**. A boolean advisory flag (`needsReview` or equivalent — implementer picks the column / payload key) is set, and the UI surfaces a small advisory chip on the segment ("Date is outside this trip's window — review"). The user can confirm, edit, or move it.
- The advisory has **no enforcement teeth**. It is not blocked, not hidden, not auto-corrected. It is a flag for human attention.
- The "way outside" case (August booking on a June trip) is the same code path as "1 week outside" — the advisory fires once and the user decides.

The pipeline never inserts a fabricated date or invents a missing field. If the extractor returned `null` for required fields (e.g. flight date missing), the mapper returns no segment and the document keeps its parsed payload alone — the user can still create the segment manually using the parsed data as reference.

## Consequences

### Positive

- **Closes the loop.** A boarding pass upload → Extract → flight appears on the itinerary, tied to the source document. The whole document pipeline finally pays for itself.
- **Manual still works.** No path is removed. Add-flight-by-form is untouched.
- **Reversibility.** Document.segmentId can be cleared (FK has `onDelete: 'set null'` on segments) and a user can unlink a misattribution without losing the document or the segment.
- **Idempotent re-extract.** Pressing Extract twice does not duplicate segments.
- **Many-passengers-one-flight is correct by default.** Uploading boarding passes for every traveller produces one flight on the itinerary with each pass attached, not N duplicate flights.
- **Soft date check is honest.** It tells the user something might be off without lying about what the document actually said. The trip stays the source of truth on its own dates; the document stays the source of truth on its own dates.
- **Passenger names stay scoped.** The Documents tab shows who a specific pass belongs to; the shared segment surfaces (Itinerary, Flights) don't. Family travellers don't see each other's names rendered on the trip view.

### Negative / tradeoffs

- **One-document → one-segment** is a real ceiling. A multi-leg booking PDF carries multiple flights; today's extraction schema only models one. Multi-segment extraction is deferred — when it lands, it's an additive change to the mapper and the schema, not a rewrite of this contract.
- **Mapper is a new surface area.** A bad mapping can write garbage into a real segment. Mitigated by: (a) Zod validation of the structured payload before mapping, (b) Zod validation of the resulting `SegmentCreateInput`, (c) the existing repo write path which is the same one the form uses.
- **Advisory chip is UI work.** A new "needs review" affordance has to land on the segment cards (itinerary and per-type tabs). Small, but real.
- **Re-extract semantics are limited.** Re-pressing Extract won't update an already-linked segment. If the original extraction was wrong and the user wants a fresh attempt, they unlink first. Acceptable for now; revisit if it becomes annoying.

### Neutral

- The `Document.segmentId` FK and the `Document.tripId` FK can coexist. A document linked to a flight segment is still also linked to its trip; deleting either link sets the FK to null but does not orphan the file (per `documents_orphaned_at_idx` sweep semantics).
- This ADR is silent on whether `needsReview` is a column on `segments` or a flag inside `segments.data`. Either works; the implementer picks. Recommendation: a column, so the existing list views can filter on it without unpacking JSONB.

## Alternatives considered

- **Auto-create on upload, before extraction.** Rejected. Upload would have to wait for the LLM round-trip, doubling perceived upload latency and introducing a silent failure mode ("upload worked but the flight didn't appear"). Manual extraction keeps the action visible to the user.
- **Hard date rejection — refuse to create a segment outside the trip window.** Rejected. Forces the user to edit the trip just to file a real document. The trip's dates are the user's _plan_; the boarding pass is _truth_. Truth wins.
- **Date snapping — clamp the segment's date to the trip's window.** Rejected. Quietly rewriting source-of-truth data from a document the user uploaded is the worst of both worlds: looks fine, is wrong.
- **Suggest a segment, require user confirmation before persisting.** Considered. Cleaner conceptually, more clicks in practice. The current decision keeps the system "do the obvious thing and let the user undo it." If misattribution rates turn out high in real use, a confirm-first variant can be added behind a setting without changing the data model.
- **Don't link the document at all — let the user manually associate after extraction.** Rejected. The whole point of the gap-close is to make the link automatic; manual association is what we already have today by hand.

## Operating rules

1. **Manual trigger only.** Segment auto-create runs inside `extractDocumentAction`, never inside `uploadDocumentAction`. Upload remains a pure file-write + row-insert.
2. **Payload → segment mapping is a single pure function.** No I/O. Lives in `src/lib/extraction/` (alongside the structured payload types) or `src/lib/segments/` — implementer's choice; one file, fully tested.
3. **Date tolerance is a named constant.** `TRIP_DATE_TOLERANCE_DAYS = 2`. If the value changes, it changes in one place.
4. **Wishlist trips skip the date check.** If `trip.startDate` or `trip.endDate` is null, the advisory flag is never set on date grounds.
5. **Re-extract is idempotent.** If `Document.segmentId` is non-null on entry, the create step is skipped. Period.
6. **Confidence is not gated.** A low-confidence extraction still creates a segment. The `parsedConfidence` field already exists on the document for downstream UI to surface; this ADR does not introduce a confidence-driven gate.
7. **Errors degrade gracefully.** If segment creation fails (validator rejects the mapped input, repo write errors), the extraction action still returns `ok` — the parsed payload was persisted, and the segment failure is logged structured. The user sees the parsed document; they can manually create the segment.

## References

- ADR-0003 — Wishlist trips via nullable `startsAt`. Justifies skipping the date check when trip dates are missing.
- ADR-0005 — Per-segment country attribution. The mapper writes `countryCode` (and `originCountryCode` for flights) so the country filter row reflects the new segment immediately.
- ADR-0006 — Ollama (local-only) for LLM extraction. Upstream of this decision; produces the `StructuredPayload` this ADR consumes.
- ADR-0009 — Drop flight-metadata lookup. The LLM extracts scheduled departure/arrival times directly, so this ADR's mapper no longer needs a downstream enrichment hop.
- `src/lib/extraction/types.ts` — `StructuredPayload` schema.
- `src/lib/segments/validators.ts` — `SegmentCreateInput` schema.
- `src/db/schema/documents.ts:63` — the `documents.segment_id` FK this ADR finally puts to work.
