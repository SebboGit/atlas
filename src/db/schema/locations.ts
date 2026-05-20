import { char, doublePrecision, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { uuidv7Pk } from './_helpers';
import { segments } from './segments';
import { trips } from './trips';

export const locations = pgTable('locations', {
  id: uuidv7Pk().primaryKey(),
  tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  address: text('address'),
  countryCode: char('country_code', { length: 2 }),
});

export type Location = typeof locations.$inferSelect;
