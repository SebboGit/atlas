import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/db/schema';

import { pocketIdProfileSchema, type PocketIDProfile } from './profile-schema';

/**
 * Refresh a local user row from fresh OIDC claims. Called from the
 * Auth.js `events.signIn` hook on EVERY successful sign-in.
 *
 * Why events.signIn and not the signIn callback?
 *   Auth.js v5 runs the signIn callback BEFORE the adapter writes to
 *   the DB. For a first-time user, `user.id` in the signIn callback
 *   refers to a row that doesn't yet exist — an UPDATE there would
 *   silently affect zero rows. The events.signIn hook fires AFTER the
 *   adapter has inserted the user, which is the correct moment to
 *   refresh display attributes and populate `sub`.
 *
 * This function is UPDATE-only. @auth/drizzle-adapter is the sole
 * INSERT path into users — see CLAUDE.md → Auth.
 *
 * The update is SPARSE: only fields that arrived in the claim get
 * written. This prevents a partial userinfo response (e.g. an IdP
 * scope change that drops `email`) from overwriting a populated
 * column with an empty string and tripping the NOT NULL constraint.
 *
 * The incoming profile is Zod-validated to cap string lengths and
 * group-array size — PocketID is trusted, but the JSON over the wire
 * is still untrusted input.
 */
export async function refreshUserFromClaims(
  localUserId: string,
  oidcSub: string,
  rawProfile: Partial<PocketIDProfile> | Record<string, unknown> | undefined,
): Promise<void> {
  // Validate + cap. If the claim shape is wildly wrong, surface it
  // loudly rather than silently corrupting the user row.
  const profile = pocketIdProfileSchema.partial().parse(rawProfile ?? {});

  // Build a sparse update — only set columns we actually have claims for.
  const update: Partial<typeof users.$inferInsert> = {
    sub: oidcSub,
    lastSeenAt: new Date(),
  };
  if (profile.email !== undefined) update.email = profile.email;
  if (profile.email_verified !== undefined) {
    update.emailVerified = profile.email_verified ? new Date() : null;
  }
  if (profile.name !== undefined || profile.preferred_username !== undefined) {
    update.name = profile.name ?? profile.preferred_username ?? null;
  }
  if (profile.groups !== undefined) update.groups = profile.groups;

  await db.update(users).set(update).where(eq(users.id, localUserId));
}
