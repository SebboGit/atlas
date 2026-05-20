import { sql } from 'drizzle-orm';
import { customType, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { uuidv7Pk } from './_helpers';

// citext lives in the pgcrypto-companion citext extension (created in
// docker/postgres/init/01-extensions.sql). Drizzle has no built-in citext,
// so we declare a thin custom type.
const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

export const users = pgTable('users', {
  id: uuidv7Pk().primaryKey(),

  // OIDC subject — immutable per identity provider. Populated by the
  // events.signIn handler after the adapter's INSERT, because the
  // adapter doesn't know about this column. Nullable to permit that
  // two-step initialisation. Unique once set.
  sub: text('sub').unique(),

  // Adapter-driven columns. @auth/drizzle-adapter writes these on
  // createUser; types must match its AdapterUser shape.
  email: citext('email').notNull(),
  emailVerified: timestamp('emailVerified', { withTimezone: true, mode: 'date' }),
  name: text('name'),
  image: text('image'),

  // Atlas-specific extensions, refreshed on every sign-in.
  groups: text('groups')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
