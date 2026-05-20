# ADR-0005: Per-segment country attribution (dual column for flights)

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** @SebboGit

## Context

Trips can span multiple countries. ADR-0004 introduced a country filter (`?country=DE`) that scopes the Hotels, Activities, and Documents tabs. The filter needs to answer, for each segment: which country (or countries) does this belong to?

For hotels, activities, transit, and notes, "which country" is singular and obvious — the country of the venue / event / stop. For flights, it's dual: a flight has both an origin country and a destination country, and the user explicitly chose that a flight should appear in the filter for **either** end (so a `LHR → HND` flight shows up under both UK and Japan filters).

Three candidate shapes:

1. **Derive from `Location`.** Locations already carry `countryCode`. The filter query joins `segments → locations → countries`.
2. **Top-level column on `segments`.** `country_code CHAR(2)` (and `origin_country_code` for flights), denormalized from the segment's origin/destination.
3. **`segment_countries` join table.** `(segment_id, country_code, role)` rows. Handles N countries per segment cleanly, but introduces a join for every filter query and a join table for a 1-or-2-cardinality relationship.

### Forces

- **The filter query is hot.** Hotels-by-country, Activities-by-country, and the itinerary-with-country-filter all run on every trip-detail tab switch when a multi-country trip is active.
- **Flights need two countries.** Origin + destination, with the filter matching either.
- **`Location` exists for the map, not for filtering.** A segment may have multiple locations (a flight has two airports), or zero locations (a note), or its location data may not have been geocoded yet (geocoding is async and best-effort). Filter behaviour cannot depend on geocoding having completed.
- **Cardinality is bounded at 2.** No segment has more than two countries in any planned model. A join table is over-engineered for a 1-or-2 relationship.
- **The countries reference table already exists** (`countries.code` is `CHAR(2)` PK, seeded from ISO 3166-1).

## Decision

`segments` gets **two nullable top-level columns**: `country_code` and `origin_country_code`, both `CHAR(2)`, both FK'd to `countries.code` with `ON DELETE RESTRICT`.

- **`country_code`** is the primary country: destination for flights, location country for everything else. Always populated when the segment has any country at all.
- **`origin_country_code`** is set **only on flights** (origin airport's country). NULL on all other segment types. NULL on flights whose origin country isn't yet known.

Two btree indexes pin the filter query: `(trip_id, country_code)` and `(trip_id, origin_country_code)`.

### Filter query

```sql
SELECT * FROM segments
WHERE trip_id = $1
  AND (country_code = $2 OR origin_country_code = $2);
```

Postgres uses `BitmapOr` across both indexes. For a personal-scale app (≤ thousands of segments per user lifetime), this is well within budget.

### Population

- **Hotel, activity, transit, note:** the repo writes `country_code` from the segment's data on insert/update. If the segment carries a `Location` with a `countryCode`, that wins. If the user enters an address without geocoding completing, the repo accepts NULL — the segment is still valid, it just doesn't participate in the country filter until country is filled in.
- **Flight:** the repo writes both `country_code` (destination) and `origin_country_code` (origin) from the flight's data. NULL for either is acceptable but the segment won't match either side of the filter for the missing end.

### Display

`Location` is still the source of truth for the map and for any rich address display. The two new columns exist purely for filtering and indexing — they are a denormalization for query performance, not a new model.

## Consequences

### Positive

- Country filter is a single `WHERE … OR …` clause on indexed columns. No join into `locations`. Hot path stays simple.
- Flights appear in the filter for both endpoints, matching the user's mental model ("show me everything in Japan" includes the flight that takes me there).
- `Location` retains its own concern (the map) without becoming load-bearing for the filter.
- Both columns are nullable, so a partially-entered segment (address pending geocoding, origin not yet known) doesn't block creation.

### Negative / tradeoffs

- Denormalization risk: country info is in two places (`segments.country_code` and the segment's geocoded `Location.countryCode`, if any). The repo layer is responsible for keeping them consistent at write time. If drift happens, the `segments` columns win for filtering; `Location` wins for map rendering.
- An `OR` across two indexed columns is slightly slower than a single equality, but for the cardinality involved it's irrelevant.
- A future segment type with three countries would require a third column or a migration to a join table. There is currently no such segment type planned.

### Neutral

- The reference data (`countries`) is already in place; no new tables.
- FK with `ON DELETE RESTRICT` means a country cannot be deleted while any segment references it. Countries are reference data — they shouldn't be deleted in practice, so RESTRICT is the safer default than CASCADE.

## Alternatives considered

- **Derive from `Location`.** Rejected: introduces a JOIN in the hottest query path; depends on geocoding having completed; breaks for flights (two locations, one trip-level filter) and for `note` (no location).
- **`segment_countries(segment_id, country_code, role)` join table.** Rejected: over-engineered for a cardinality of at most 2. Adds a JOIN to every filter query and a write per country on every segment mutation. Would be the right answer if cardinality were unbounded.
- **Single `country_code` only, with flights stored under their destination.** Rejected: the user explicitly wanted flights to surface for both endpoints. A single column makes the filter for the origin country invisible.
- **Both countries packed into JSONB `data`.** Rejected: the country filter is the most predicate-heavy query in the app; JSONB predicates can be indexed (GIN) but the operational cost is higher than a flat indexed column for a bounded enum-like value.

## References

- ADR-0003 — wishlist via nullable `startsAt` (related: hot-path query budget for the segments table).
- ADR-0004 — tabbed trip detail (consumer of this filter).
- `src/db/schema/segments.ts` — column definitions and indexes.
- `src/db/schema/locations.ts` — retained for map / rich-address use.
