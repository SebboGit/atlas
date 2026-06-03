import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { tsvector, uuidv7Pk } from './_helpers';
import { countries } from './countries';
import { trips } from './trips';
import { wishlistItems } from './wishlist-items';

export const segmentType = pgEnum('segment_type', [
  'flight',
  'hotel',
  'activity',
  'transit',
  'food',
  'note',
]);

export const segments = pgTable(
  'segments',
  {
    id: uuidv7Pk().primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    type: segmentType('type').notNull(),
    // Per-type structured data. Schema for each type is validated at the
    // application layer via Zod (see src/lib/validators/).
    data: jsonb('data').notNull().default({}),
    // Hot-path columns lifted out of `data` for indexing. Keep these in
    // sync with `data` on every write — repo layer's job.
    //
    // For `activity` segments, a NULL `startsAt` is the **undated** state:
    // the activity belongs to the trip but isn't pinned to a date yet.
    // For other segment types, NULL means "date not yet specified" / TBD.
    // See ADR-0003 (the term "wishlist" for this state is retired from the
    // UI — that name now refers only to the household wishlist feature).
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    locationName: text('location_name'),
    // Country attribution for filtering. `countryCode` is the primary
    // country (destination for flights, location for everything else).
    // `originCountryCode` is set only on flights; the country filter
    // matches `countryCode OR originCountryCode = ?`. See ADR-0005.
    countryCode: char('country_code', { length: 2 }).references(() => countries.code, {
      onDelete: 'restrict',
    }),
    originCountryCode: char('origin_country_code', { length: 2 }).references(() => countries.code, {
      onDelete: 'restrict',
    }),
    // Advisory flag set by the document-extraction pipeline when a
    // newly-created segment's date falls outside the trip's ±2 day
    // tolerance window (see ADR-0008). Has no enforcement teeth — the
    // segment still exists, still renders normally; the UI surfaces a
    // small chip prompting the user to verify the date or trip. NULL
    // and FALSE are equivalent ("nothing to review"). Manual segment
    // creation never sets this.
    needsReview: boolean('needs_review').notNull().default(false),
    // Provenance backref for segments that were materialised from a
    // global wishlist item (src/db/schema/wishlist-items.ts). NULL for
    // segments entered directly. ON DELETE SET NULL — deleting the
    // wishlist item must not cascade-delete materialised segments;
    // the segment keeps its data snapshot, just loses the link back.
    wishlistItemId: uuid('wishlist_item_id').references(() => wishlistItems.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    // Global Cmd+K search. Postgres maintains both columns via
    // GENERATED ALWAYS — never .insert()/.update() them. The
    // regexp_replace inserts a space at every lowercase→uppercase
    // boundary so CamelCase carrier names (`AirAsia`, `EasyJet`) get
    // tokenised as separate words and match natural-language queries
    // like "Air Asia". See migration 0012.
    searchText: text('search_text').generatedAlwaysAs(
      sql`regexp_replace(coalesce(location_name, '') || ' ' || extract_jsonb_text(data), '([a-z])([A-Z])', '\\1 \\2', 'g')`,
    ),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', regexp_replace(coalesce(location_name, ''), '([a-z])([A-Z])', '\\1 \\2', 'g')), 'A') || setweight(to_tsvector('simple', regexp_replace(extract_jsonb_text(data), '([a-z])([A-Z])', '\\1 \\2', 'g')), 'B')`,
    ),
  },
  (s) => [
    index('segments_trip_starts_idx').on(s.tripId, s.startsAt),
    index('segments_type_idx').on(s.type),
    index('segments_trip_country_idx').on(s.tripId, s.countryCode),
    index('segments_trip_origin_country_idx').on(s.tripId, s.originCountryCode),
    // Suggestions panel filter: "items NOT already materialised on
    // this trip". Without this index the NOT IN subquery scans all
    // segments. Partial index — only rows actually carrying a backref
    // are interesting, the rest are noise.
    index('segments_wishlist_item_id_idx')
      .on(s.wishlistItemId)
      .where(sql`${s.wishlistItemId} IS NOT NULL`),
    index('segments_search_tsv_idx').using('gin', s.searchTsv),
    index('segments_search_text_trgm_idx').using('gin', sql`${s.searchText} gin_trgm_ops`),
  ],
);

export type Segment = typeof segments.$inferSelect;
export type NewSegment = typeof segments.$inferInsert;
