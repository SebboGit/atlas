import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

// Auth.js (next-auth v5) tables, in the shape expected by
// @auth/drizzle-adapter. Names and column types must match the adapter's
// expectations exactly — refer to:
// https://authjs.dev/getting-started/adapters/drizzle

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
);

// The nightly prune (src/lib/maintenance/prune.ts) deletes expired rows
// with `WHERE expires < now()`. Index the predicate so the sweep doesn't
// seq-scan the table as sessions accumulate.
export const sessions = pgTable(
  'sessions',
  {
    sessionToken: text('sessionToken').primaryKey(),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (s) => [index('sessions_expires_idx').on(s.expires)],
);

export const verificationTokens = pgTable(
  'verificationTokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (vt) => [
    primaryKey({ columns: [vt.identifier, vt.token] }),
    // Same nightly-prune predicate as sessions.expires.
    index('verification_tokens_expires_idx').on(vt.expires),
  ],
);
