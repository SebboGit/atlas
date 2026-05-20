import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { db } from '@/db/client';
import { users, type User } from '@/db/schema';

import { auth } from './config';

// Hot path: an RSC tree often calls getCurrentUser() / requireUser()
// from multiple components in the same render (layout + page + a
// SidebarUserMenu, etc.). Without dedupe each one would do its own DB
// round-trip. React.cache() makes the function memoise within a single
// request, so they collapse into one query.
//
// IMPORTANT: do NOT cache across requests. That would defeat session
// revocation — the whole point of DB-backed sessions per ADR-0002.

/**
 * Resolve the current user from the Auth.js session. Returns `null` if
 * the request is unauthenticated.
 *
 * Feature code calls this — it MUST NOT import from `next-auth`
 * directly. See CLAUDE.md → Architectural Guardrails.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
});

/**
 * Resolve the current user or redirect to sign-in. Use in Server
 * Components and Server Actions that require an authenticated user.
 *
 * Proxy (src/proxy.ts) already redirects unauthenticated requests
 * on /(app)/* — this helper is the inner-ring guarantee that
 * server data access has a user attached.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect('/signin');
  return user;
}
