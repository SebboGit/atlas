# Domain Model

> The schema in [`src/db/schema/`](../src/db/schema/) is the source of
> truth; this file explains the _why_ behind it. Last reviewed: 2026-05-30.

## Entities

### User

- Identity for sign-in and provenance. Built for one user or a small household; every aggregate carries `userId` / `createdBy`, which records who created a row, not exclusive ownership — see the visibility note under "Out of model".
- Created **just-in-time** on first successful OIDC sign-in via PocketID. No registration form.
- Fields: `id`, `sub` (OIDC subject — immutable, unique), `email`, `name`, `groups[]`, `createdAt`, `lastSeenAt`.
- `email`, `name`, `groups` refreshed from claims on every sign-in.
- See ADR-0002 and `src/lib/auth/`.

### Trip

- A bounded period of travel with one or more destinations.
- Fields: `id`, `userId`, `title`, `summary`, `status` (`planned` | `active` | `completed` | `archived`), `startDate`, `endDate`, `coverImageId`, timestamps.
- Has many `Country` (m:n), `Segment`, `Location`.

### Country

- Reference data (ISO 3166-1 alpha-2). Joined to Trip via `trip_countries`.

### Segment

- Anything that happens during a trip. Discriminated union:
  - `flight` — origin, destination, departure/arrival times, carrier, flight number, PNR, seat.
  - `hotel` — name, address, check-in/out, confirmation, room type, price.
  - `activity` — name, location, date/time, booking ref, price. **Two states**: scheduled (`startsAt IS NOT NULL`, lives in the itinerary) and wishlist (`startsAt IS NULL`, undated intention pinned to the trip). See ADR-0003.
  - `transit` — non-flight transit (train, ferry, rental car).
  - `food` — a restaurant booking or a meal slotted on the itinerary. Venue name, optional booking reference; the reservation time is the shared `startsAt`. Split from `activity` because a trip has far more meals than attractions and the two slot by different rhythms — see the food-segment design note.
  - `note` — freeform text/markdown, optional date.
- Stored as `(type, data: jsonb)` plus a few hot-path columns lifted to top-level for indexing: `startsAt`, `endsAt`, `locationName`, `countryCode`, `originCountryCode`.
- **Country attribution** (see ADR-0005): `countryCode` is the primary country (destination for flights, location country for everything else). `originCountryCode` is set only on flights and carries the origin country. The country filter matches either column, so a flight surfaces under both endpoints.
- Has many `Document`.
- `wishlistItemId` is the optional link back to the `WishlistItem` this segment was materialised from. NULL for segments created directly.

### WishlistItem

- The household's reusable, country-scoped place list — food spots and attractions worth coming back to. Independent of any single trip and shared across the household.
- Two layers of "wishlist" coexist in Atlas, and they are not the same thing:
  - **`WishlistItem` (this table)** — global, country-scoped, reusable across trips. A Tokyo ramen spot keeps surfacing as a suggestion on every future Japan trip, even after it was scheduled on a previous one.
  - **A per-trip wishlist `Segment` (`startsAt IS NULL`)** — an undated intention pinned to one trip (see ADR-0003 and the Segment invariant below).
- Covers only `food` and `activity`. Fields: `id`, `type` (`food` | `activity`), `countryCode` (required — gates the per-trip suggestions panel), `locationName` (pin label, not the venue name), `notes`, `tags[]`, `data: jsonb`, `createdBy`, timestamps.
- The per-type `data` shape mirrors the matching segment data exactly (`food = { venue, address?, bookingRef? }`, `activity = { title, description?, bookingRef? }`), so materialisation is a verbatim copy. Validated at the application layer via `src/lib/wishlist/validators.ts`, which reuses the segment data shapes.
- **Materialisation:** adding a `WishlistItem` to a trip creates an undated `Segment` of the matching type with `data` copied across and `segments.wishlistItemId` set as provenance. The wishlist item itself is unchanged and stays available for other trips. Promoting that segment onto the itinerary is then the same single-column `startsAt` update as any other wishlist segment.
- `createdBy` is provenance only (drives an "added by …" tag), not an auth filter — wishlist items are household-shared per the visibility model.

### Document

- An uploaded file (PDF, image, PKPass, EML) with derived structured data.
- Fields: `id`, `userId`, `tripId?`, `segmentId?`, `objectKey` (filesystem key relative to `STORAGE_DIR`), `mime`, `bytes`, `sha256`, `originalName`, `parsed: jsonb`, `parsedConfidence`, `parsedBy` (extraction method), `reviewStatus`, `overrides: jsonb`, `orphanedAt?` (set when a document is unlinked from both trip and segment), `createdAt`.
- **Immutable original.** `objectKey` never changes. Reparsing updates `parsed`/`parsedBy`/`parsedConfidence` only.
- `overrides` holds user-confirmed values that survive reparses.
- `objectKey` format: `<yyyy>/<mm>/<uuid><ext>`. Generated by the storage adapter; never user-influenced.

### Location

- Geocoded point. Fields: `id`, `tripId?`, `segmentId?`, `name`, `lat`, `lng`, `address`, `countryCode`.

## Invariants

1. **Money is `(amountMinor: integer, currency: text)`.** Never float.
2. **Timestamps are `timestamptz`.** Display is a UI concern.
3. **A Document is immutable in its original form.** New version = new Document row, new `objectKey`. The file on disk is never overwritten.
4. **Idempotent imports.** `Document.sha256` is unique per user — uploading the same boarding pass twice is a no-op (returns the existing Document).
5. **A Segment's location data is duplicated to `Location` rows** for map rendering — keeps map queries fast and lets the user add custom pins. Country attribution for _filtering_ lives on `Segment.countryCode` / `originCountryCode` (denormalised from data); `Location.countryCode` remains the source of truth for the map.
6. **Per-trip wishlist state is encoded by `startsAt`.** Defined for `activity` (ADR-0003): a NULL `startsAt` means the segment sits on that trip's wishlist (no date assigned yet); a non-NULL value means it is scheduled on the itinerary. Promotion to scheduled is a single-column `UPDATE`; demotion is the reverse. A materialised `WishlistItem` of type `activity` lands in exactly this state and follows the same promote/demote rule, carrying its `wishlistItemId` as provenance. Materialised `food` is different: `materialiseOnTrip` also creates it with `startsAt = null` and a `wishlistItemId`, but food has no scheduled/wishlist promotion machinery — there a NULL `startsAt` just means the meal is undated (an in-trip shortlist), the same "date not yet specified" meaning NULL keeps for every non-`activity` type. This per-trip wishlist is distinct from the global, reusable `WishlistItem` table described above.
7. **Cascades:** Deleting a Trip **hard-deletes** its Segments (`ON DELETE CASCADE`) and **unlinks** Documents (`tripId` / `segmentId` set to NULL). Unlinked Documents are _orphans_ and retain their files on disk; a periodic job sweeps them after a grace period (see invariant #7). Soft-delete was considered and rejected: it would push `deletedAt IS NULL` filters into every list query and uniqueness check, and Atlas's "operational simplicity wins ties" rule (CLAUDE.md) tips the balance the other way. Trip "undo" can be implemented at the UI layer with a confirm step or by using the existing `archived` trip status.
8. **File-on-disk lifetime.** A Document row deletion removes the file. A Document row UPDATE never touches the file. Orphaning a Document (unlinking from trip and segment) stamps `orphanedAt` so the periodic sweep can distinguish "just uploaded, not yet linked" from "was linked, parent went away N days ago."

## Why JSONB for segments?

Segment shapes evolve (a flight might gain "lounge access", a hotel might gain "loyalty number"). JSONB lets the schema absorb additions without migrations. The cost is less SQL-level type safety — Drizzle + Zod compensate at the application layer.

When a JSONB field stabilizes and is queried often, promote it to a real column.

## Why a generic Document table?

One table = one extraction pipeline, one upload UI, one storage adapter, one backup target. Per-segment-type document tables would scatter that.

## Out of model (for now)

- Expenses & budgets — additive later.
- Itinerary timeline reordering with conflict detection — UI concern when needed.
- Per-trip privacy — modelled via `trips.visibility` (`household` | `private`, ADR-0015). Default `household`: `userId` / `createdBy` stay provenance for reads, and one predicate (`tripVisibleToViewer`) gates every content read/write. A trip's creator can mark it `private` (owner-only); trip-row mutations stay owner-only; documents stay uploader-scoped. A further tier (per-member ACLs) would need a join table and a new ADR — not modelled.
