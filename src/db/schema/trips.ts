import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tsvector, uuidv7Pk } from './_helpers';
import { users } from './users';

export const tripStatus = pgEnum('trip_status', ['planned', 'active', 'completed', 'archived']);

export const trips = pgTable(
  'trips',
  {
    id: uuidv7Pk().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary'),
    status: tripStatus('status').notNull().default('planned'),
    startDate: timestamp('start_date', { withTimezone: true, mode: 'date' }),
    endDate: timestamp('end_date', { withTimezone: true, mode: 'date' }),
    // coverImageId is deliberately omitted from the initial migration to
    // avoid a circular FK with documents on day one. Will be added in a
    // follow-up migration once Document is in production use.
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    // Global Cmd+K search. Postgres maintains both columns via
    // GENERATED ALWAYS — never .insert()/.update() them.
    searchText: text('search_text').generatedAlwaysAs(
      sql`coalesce(title, '') || ' ' || coalesce(summary, '')`,
    ),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(summary, '')), 'B')`,
    ),
  },
  (t) => [
    index('trips_user_id_idx').on(t.userId),
    index('trips_status_idx').on(t.status),
    index('trips_search_tsv_idx').using('gin', t.searchTsv),
    index('trips_search_text_trgm_idx').using('gin', sql`${t.searchText} gin_trgm_ops`),
  ],
);

export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;
