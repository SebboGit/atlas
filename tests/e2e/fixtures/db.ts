import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { geocodeCache, segments, sessions, trips, users, wishlistItems } from '@/db/schema';
import { normalizeQuery } from '@/lib/geocoding/normalize';
import { buildGeocodeQuery } from '@/lib/geocoding/segment-query';

import { assertTestDatabase } from './safety';

// RFC 2606 reserves the `.invalid` TLD; it can never resolve to a real
// inbox and can never match a real signed-in identity. Every test user
// created by this fixture uses one of THESE exact emails, so cleanup is a
// `DELETE` chain rooted on a single, throwaway identity.
export const TEST_USER_EMAIL = 'e2e@test.invalid';
// Distinct sentinels for multi-user specs (the ADR-0015 visibility
// boundary). A two-user test holds two live identities at once, so they
// need separate emails — otherwise each `createTestUserWithSession` call
// would truncate the other's rows on its leading cleanup. Both are still
// `.invalid`, so the same safety guard and never-collides guarantee hold.
export const TEST_OWNER_EMAIL = 'e2e-owner@test.invalid';
export const TEST_MEMBER_EMAIL = 'e2e-member@test.invalid';

export interface TestUserHandle {
  id: string;
  sessionToken: string;
}

// Create a test user + active DB session. Returns the IDs the caller
// needs to set the cookie and (optionally) seed further data attached
// to that user. `email` defaults to the single-user sentinel; multi-user
// specs pass a distinct sentinel per identity.
export async function createTestUserWithSession(
  email: string = TEST_USER_EMAIL,
): Promise<TestUserHandle> {
  assertTestDatabase();
  // Cascade from prior crashed runs that may have left state behind.
  // Scoped to THIS identity so a sibling identity created moments earlier
  // (a two-user test) survives.
  await cleanupTestUser(email);

  // Insert the user. Production goes through Auth.js's drizzle adapter
  // + the events.signIn hook which sets `sub` — we bypass Auth.js
  // entirely, so we set `sub` ourselves with a clearly-test prefix
  // that cannot collide with a real PocketID identity.
  const inserted = await db
    .insert(users)
    .values({
      sub: `e2e-${randomUUID()}`,
      email,
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
export async function cleanupTestUser(email: string = TEST_USER_EMAIL): Promise<void> {
  assertTestDatabase();
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  for (const row of rows) {
    await db.delete(wishlistItems).where(eq(wishlistItems.createdBy, row.id));
  }
  await db.delete(users).where(eq(users.email, email));
}

export interface SeedTripValues {
  title: string;
  status?: 'planned' | 'active' | 'completed' | 'archived';
  startDate?: Date | null;
  endDate?: Date | null;
  // Defaults to the DB default (`household`); the visibility spec sets
  // `private` to seed an owner-only trip (ADR-0015).
  visibility?: 'household' | 'private';
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
      visibility: values.visibility ?? 'household',
    })
    .returning({ id: trips.id });
  const row = inserted[0];
  if (!row) throw new Error('E2E fixture: failed to seed trip.');
  return row.id;
}

export interface SeedActivityValues {
  title: string;
  startsAt?: Date | null;
  // Set alongside `startsAt` to span days — a multi-day activity surfaces
  // the non-hotel ("Ongoing") continuation rows, mirroring the hotel's.
  endsAt?: Date | null;
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
      endsAt: values.endsAt ?? null,
      locationName: values.locationName ?? null,
      countryCode: values.countryCode ?? null,
    })
    .returning({ id: segments.id });
  const row = inserted[0];
  if (!row) throw new Error('E2E fixture: failed to seed segment.');
  return row.id;
}

export interface SeedHotelValues {
  propertyName: string;
  // A multi-day stay needs both ends so `continuesThroughDay` (and the
  // itinerary's "Staying since" continuation rows) treat it as ongoing.
  startsAt: Date;
  endsAt: Date;
  countryCode?: string | null;
  locationName?: string | null;
}

// Hotel segment — the span-capable type behind the collapsed-past
// continuation rows. A stay that checks in on a collapsed past day and
// runs through today surfaces as a "Staying since" row on the visible
// days (see day-temporal.ts `continuesThroughDay`).
export async function seedHotelSegment(tripId: string, values: SeedHotelValues): Promise<string> {
  assertTestDatabase();
  const inserted = await db
    .insert(segments)
    .values({
      tripId,
      type: 'hotel',
      data: { propertyName: values.propertyName },
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      locationName: values.locationName ?? null,
      countryCode: values.countryCode ?? null,
    })
    .returning({ id: segments.id });
  const row = inserted[0];
  if (!row) throw new Error('E2E fixture: failed to seed hotel segment.');
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

// Activity segment that the trip-map repo will resolve to a real pin.
// Inserts the segment AND seeds a positive geocode_cache row keyed on
// the production buildGeocodeQuery output — so the repo treats it as
// `kind: 'hit'` without waiting on a live Nominatim call. Required
// when a test needs "everything is pinned" as a control case, since a
// missing cache row reads as `kind: 'miss'` and still surfaces the
// segment as ungeocoded with a "geocoding pending" reason.
export async function seedGeocodedActivitySegment(
  tripId: string,
  values: {
    title: string;
    locationName: string;
    countryCode?: string | null;
    lat: number;
    lng: number;
  },
): Promise<string> {
  assertTestDatabase();
  const inserted = await db
    .insert(segments)
    .values({
      tripId,
      type: 'activity',
      data: { title: values.title },
      locationName: values.locationName,
      countryCode: values.countryCode ?? null,
    })
    .returning({ id: segments.id });
  const row = inserted[0];
  if (!row) throw new Error('E2E fixture: failed to seed geocoded segment.');

  const query = buildGeocodeQuery({
    type: 'activity',
    data: { title: values.title },
    locationName: values.locationName,
  });
  if (!query) throw new Error('E2E fixture: buildGeocodeQuery returned null.');

  await db
    .insert(geocodeCache)
    .values({
      queryNormalized: normalizeQuery(query),
      lat: values.lat,
      lng: values.lng,
      displayName: query,
      source: 'nominatim',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .onConflictDoUpdate({
      target: geocodeCache.queryNormalized,
      set: { lat: values.lat, lng: values.lng, displayName: query },
    });

  return row.id;
}

// Activity segment that the trip-map repo will report as ungeocoded.
// Inserts the segment AND seeds a NULL geocode_cache row keyed on the
// production buildGeocodeQuery output — so the repo's cache lookup
// reads `kind: 'null'` and the segment lands in the "Not pinned" list
// without a live Nominatim call. Required because Playwright + live
// network = flake.
export async function seedUngeocodedActivitySegment(
  tripId: string,
  values: { title: string; countryCode?: string | null },
): Promise<string> {
  assertTestDatabase();
  const inserted = await db
    .insert(segments)
    .values({
      tripId,
      type: 'activity',
      data: { title: values.title },
      // No `locationName` — keeps the cache key (built from title alone
      // by buildGeocodeQuery) free of values that might collide with a
      // real lookup elsewhere.
      countryCode: values.countryCode ?? null,
    })
    .returning({ id: segments.id });
  const row = inserted[0];
  if (!row) throw new Error('E2E fixture: failed to seed ungeocoded segment.');

  const query = buildGeocodeQuery({
    type: 'activity',
    data: { title: values.title },
    locationName: null,
  });
  if (!query) throw new Error('E2E fixture: buildGeocodeQuery returned null for activity title.');

  await db
    .insert(geocodeCache)
    .values({
      queryNormalized: normalizeQuery(query),
      lat: null,
      lng: null,
      displayName: null,
      source: 'nominatim',
      // 1d is plenty for a test run; the cleanup deletes the row when
      // it cascades from the trip anyway, so TTL is advisory only.
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .onConflictDoUpdate({
      target: geocodeCache.queryNormalized,
      set: { lat: null, lng: null, displayName: null },
    });

  return row.id;
}
