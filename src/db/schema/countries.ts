import { char, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { trips } from './trips';
import { users } from './users';

// Reference data — ISO 3166-1 alpha-2. Seeded by scripts/seed.ts.
export const countries = pgTable('countries', {
  code: char('code', { length: 2 }).primaryKey(),
  name: text('name').notNull(),
});

export const tripCountries = pgTable(
  'trip_countries',
  {
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code, { onDelete: 'restrict' }),
  },
  (tc) => [primaryKey({ columns: [tc.tripId, tc.countryCode] })],
);

export type Country = typeof countries.$inferSelect;

// Per-user manual marks for the world map. Lets a user paint countries
// they visited before Atlas existed (or trips they don't intend to
// log here) without having to fabricate trip + segment rows just to
// fill in the choropleth. Trip-derived "visited" status (from segment
// country codes) is merged with these manual rows at read time —
// neither source overrides the other.
export const userVisitedCountries = pgTable(
  'user_visited_countries',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (uvc) => [primaryKey({ columns: [uvc.userId, uvc.countryCode] })],
);

export type UserVisitedCountry = typeof userVisitedCountries.$inferSelect;
