import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { segments, sessions, trips, users, wishlistItems } from '@/db/schema';

import { assertTestDatabase } from './safety';

// RFC 2606 reserves the `.invalid` TLD; it can never resolve to a real
// inbox and can never match a real signed-in identity. Every test user
// created by this fixture uses THIS exact email, so cleanup is a
// `DELETE` chain rooted on a single, throwaway identity.
export const TEST_USER_EMAIL = 'e2e@test.invalid';

export interface TestUserHandle {
  id: string;
  sessionToken: string;
}

// Create a test user + active DB session. Returns the IDs the caller
// needs to set the cookie and (optionally) seed further data attached
// to that user.
export async function createTestUserWithSession(): Promise<TestUserHandle> {
  assertTestDatabase();
  // Cascade from prior crashed runs that may have left state behind.
  await cleanupTestUser();

  // Insert the user. Production goes through Auth.js's drizzle adapter
  // + the events.signIn hook which sets `sub` — we bypass Auth.js
  // entirely, so we set `sub` ourselves with a clearly-test prefix
  // that cannot collide with a real PocketID identity.
  const inserted = await db
    .insert(users)
    .values({
      sub: `e2e-${randomUUID()}`,
      email: TEST_USER_EMAIL,
      name: 'E2E Test',
      emailVerified: new Date(),
    })
    .returning({ id: users.id });
  const user = inserted[0];
  if (!user) throw new Error('E2E fixture: failed to insert test user.');

  // DB-session strategy: the cookie value IS the session token. Auth.js
  // does not sign it. The proxy is cookie-presence only; the real check
  // is requireUser() doing a SELECT against this row.
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ sessionToken, userId: user.id, expires });

  return { id: user.id, sessionToken };
}

// Delete the sentinel user and everything they created.
//
// Not all child tables cascade. `wishlist_items.created_by` is
// `ON DELETE RESTRICT` (per the household-visibility model: `createdBy`
// is provenance, not ownership), so we must delete wishlist rows before
// touching the user. `sessions.userId` and `trips.userId` are CASCADE,
// so dropping the user removes the session + every trip + their
// segments + document-segment join rows automatically.
export async function cleanupTestUser(): Promise<void> {
  assertTestDatabase();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, TEST_USER_EMAIL));
  for (const row of rows) {
    await db.delete(wishlistItems).where(eq(wishlistItems.createdBy, row.id));
  }
  await db.delete(users).where(eq(users.email, TEST_USER_EMAIL));
}

export interface SeedTripValues {
  title: string;
  status?: 'planned' | 'active' | 'completed' | 'archived';
  startDate?: Date | null;
  endDate?: Date | null;
}

export async function seedTrip(userId: string, values: SeedTripValues): Promise<string> {
  assertTestDatabase();
  const inserted = await db
    .insert(trips)
    .values({
      userId,
      title: values.title,
      status: values.status ?? 'planned',
      startDate: values.startDate ?? null,
      endDate: values.endDate ?? null,
    })
    .returning({ id: trips.id });
  const row = inserted[0];
  if (!row) throw new Error('E2E fixture: failed to seed trip.');
  return row.id;
}

export interface SeedActivityValues {
  title: string;
  startsAt?: Date | null;
  countryCode?: string | null;
  locationName?: string | null;
}

// Activity segment is the simplest non-flight type — single required
// field (title) in the JSONB payload, no airline/airport lookup, no
// pkpass shape. Enough to verify a trip detail page renders inline
// segment cards under the fixture.
export async function seedActivitySegment(
  tripId: string,
  values: SeedActivityValues,
): Promise<string> {
  assertTestDatabase();
  const inserted = await db
    .insert(segments)
    .values({
      tripId,
      type: 'activity',
      data: { title: values.title },
      startsAt: values.startsAt ?? null,
      locationName: values.locationName ?? null,
      countryCode: values.countryCode ?? null,
    })
    .returning({ id: segments.id });
  const row = inserted[0];
  if (!row) throw new Error('E2E fixture: failed to seed segment.');
  return row.id;
}

export interface SeedWishlistValues {
  title: string;
  countryCode: string;
  locationName?: string | null;
}

export async function seedWishlistActivity(
  userId: string,
  values: SeedWishlistValues,
): Promise<string> {
  assertTestDatabase();
  const inserted = await db
    .insert(wishlistItems)
    .values({
      type: 'activity',
      countryCode: values.countryCode,
      locationName: values.locationName ?? null,
      data: { title: values.title },
      createdBy: userId,
    })
    .returning({ id: wishlistItems.id });
  const row = inserted[0];
  if (!row) throw new Error('E2E fixture: failed to seed wishlist item.');
  return row.id;
}
