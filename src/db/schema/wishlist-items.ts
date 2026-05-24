import { sql } from 'drizzle-orm';
import { char, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tsvector, uuidv7Pk } from './_helpers';
import { countries } from './countries';
import { users } from './users';

// Wishlist items are the household's reusable place list — food spots
// and attractions worth coming back to. Items survive being added to
// trips: a Tokyo ramen spot keeps appearing as a suggestion on every
// future Japan trip, even after it's been scheduled on a previous one.
//
// Two layers of "wishlist" exist in Atlas:
//
//   - This table   — global, country-scoped, reusable across trips.
//   - segments.startsAt = NULL — per-trip wishlist (ADR-0003): things
//     the user wants to do on *this* trip but hasn't dated yet.
//
// Adding a global wishlist item to a trip *materialises* it as an
// undated segment of the matching type. The segment's `data` is a
// verbatim copy of the wishlist `data`, which is why the per-type
// JSONB shapes mirror the segment shapes exactly (food = { venue,
// address?, bookingRef? }, activity = { title, description?,
// bookingRef? }). `segments.wishlistItemId` records the provenance.
export const wishlistItemType = pgEnum('wishlist_item_type', ['food', 'activity']);

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    id: uuidv7Pk().primaryKey(),
    type: wishlistItemType('type').notNull(),
    // Country gating for the per-trip suggestions panel. Required —
    // wishlist items only make sense as country-scoped suggestions.
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code, { onDelete: 'restrict' }),
    // Pin-style label such as "Ginza" or "Asakusa". NOT the venue or
    // attraction name — same role as on segments. Copied verbatim to
    // the materialised segment.
    locationName: text('location_name'),
    notes: text('notes'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Per-type structured data. Schema validated at the application
    // layer via Zod (src/lib/wishlist/validators.ts), which re-uses
    // the food/activity segment data shapes so materialisation is a
    // direct copy.
    data: jsonb('data').notNull().default({}),
    // Provenance only — drives an "added by Sebastian" tag in the UI.
    // NOT an auth filter; wishlist items are household-shared per the
    // visibility model.
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    // Global Cmd+K search. Postgres maintains both columns via
    // GENERATED ALWAYS — never .insert()/.update() them. Same CamelCase
    // split as segments so "AirAsia" tokenises as two words.
    //
    // `tags` is deliberately NOT in the FTS columns. Postgres marks
    // `array_to_string` STABLE, and STABLE functions can't appear in
    // generated expressions. Tag filtering happens via `ANY(tags)`
    // (UI chip), which is the right primary affordance anyway —
    // tags are short and benefit more from exact-match filtering
    // than from full-text scoring.
    searchText: text('search_text').generatedAlwaysAs(
      sql`regexp_replace(coalesce(location_name, '') || ' ' || coalesce(notes, '') || ' ' || extract_jsonb_text(data), '([a-z])([A-Z])', '\\1 \\2', 'g')`,
    ),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', regexp_replace(extract_jsonb_text(data), '([a-z])([A-Z])', '\\1 \\2', 'g')), 'A') || setweight(to_tsvector('simple', regexp_replace(coalesce(location_name, ''), '([a-z])([A-Z])', '\\1 \\2', 'g')), 'B') || setweight(to_tsvector('simple', coalesce(notes, '')), 'C')`,
    ),
  },
  (w) => [
    // Suggestions panel: WHERE country_code IN (...) AND type = ?
    index('wishlist_items_country_type_idx').on(w.countryCode, w.type),
    // /wishlist default sort.
    index('wishlist_items_created_at_idx').on(w.createdAt),
    // Cmd+K palette.
    index('wishlist_items_search_tsv_idx').using('gin', w.searchTsv),
    index('wishlist_items_search_text_trgm_idx').using('gin', sql`${w.searchText} gin_trgm_ops`),
  ],
);

export type WishlistItem = typeof wishlistItems.$inferSelect;
export type NewWishlistItem = typeof wishlistItems.$inferInsert;
