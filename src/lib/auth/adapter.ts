import { DrizzleAdapter } from '@auth/drizzle-adapter';

import { db } from '@/db/client';
import { accounts, sessions, users, verificationTokens } from '@/db/schema';

// Wire the Drizzle adapter to our actual tables.
//
// We cast `usersTable` to `any` because @auth/drizzle-adapter's strict
// users-table type doesn't recognise our citext email column (it expects
// PgText | PgVarchar). At the database layer citext is text-compatible
// — inserts and selects work identically — so the mismatch is purely a
// TypeScript artefact. The outer `as any` covers the v5-beta vs.
// adapter-types lag on the Adapter return type.
//
// Atlas-specific columns (sub, groups, createdAt, lastSeenAt) sit on
// users alongside the adapter-driven ones; the adapter ignores them on
// INSERT — see jit-user.ts for how they're populated post-insert.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const drizzleAdapter = DrizzleAdapter(db, {
  usersTable: users as any,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
}) as any;
/* eslint-enable @typescript-eslint/no-explicit-any */
