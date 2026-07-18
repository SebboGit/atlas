import { doublePrecision, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Geocode cache for free-text → coordinates lookups. See ADR-0010.
//
// PK is the *normalized* query string (lowercase, trimmed, whitespace
// collapsed) so casing and trivial whitespace differences don't multiply
// rows for the same logical place. The cache module
// (src/lib/geocoding/cache.ts) owns the normalisation; callers never
// touch this table directly.
//
// Negative cache: when the geocoder returns null (no result, 5xx, rate
// limit), we still store a row — with `lat`/`lng`/`displayName` NULL —
// so we don't hammer the upstream provider for the same unresolvable
// string on every render. The TTL on a null row is intentionally
// shorter (see ADR-0010 — 7d nulls vs 90d hits) so a once-a-week sync
// will retry a fixable typo without flooding Nominatim per page load.
//
// `expiresAt` is read-side: a row past its `expiresAt` is treated as a
// cache miss and overwritten in place on the next fetch. Storage
// reclaim is operational, not behavioural — `scripts/prune.ts`
// (`pnpm db:prune`) sweeps expired rows from cron; missing a sweep
// only costs disk, never correctness.
export const geocodeCache = pgTable('geocode_cache', {
  queryNormalized: text('query_normalized').primaryKey(),
  // Nullable on both axes: NULL = "geocoder returned no result"
  // (negative cache row). Coordinates are doublePrecision to match the
  // existing `locations` table convention — Drizzle hands them back as
  // native JS numbers, no NUMERIC-string round-trip.
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  displayName: text('display_name'),
  // Provider identifier. 'photon' / 'nominatim' / 'plus-code' for hits, 'none' for misses (ADR-0018); the column exists
  // so a future second provider (per ADR-0010 "when to revisit") can be
  // distinguished from cached Nominatim rows for back-fills or debugging.
  source: text('source').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export type GeocodeCacheRow = typeof geocodeCache.$inferSelect;
export type NewGeocodeCacheRow = typeof geocodeCache.$inferInsert;
