import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { geocodeCache, segments, sessions, trips, users, wishlistItems } from '@/db/schema';
import { normalizeQuery } from '@/lib/geocoding/normalize';
import { buildGeocodeQuery, buildTransitEndpointQueries } from '@/lib/geocoding/segment-query';

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

export interface SeedFoodValues {
  venue: string;
  startsAt?: Date | null;
  countryCode?: string | null;
  locationName?: string | null;
}

// Food segment — same shell and same grid markup as activities, so the
// horizontal-overflow guard needs one on the Food tab too (an empty tab
// renders TabEmpty instead of the grid and would test nothing).
export async function seedFoodSegment(tripId: string, values: SeedFoodValues): Promise<string> {
  assertTestDatabase();
  const inserted = await db
    .insert(segments)
    .values({
      tripId,
      type: 'food',
      data: { venue: values.venue },
      startsAt: values.startsAt ?? null,
      endsAt: null,
      locationName: values.locationName ?? null,
      countryCode: values.countryCode ?? null,
    })
    .returning({ id: segments.id });
  const row = inserted[0];
  if (!row) throw new Error('E2E fixture: failed to seed food segment.');
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
  // Display-only `data` metadata (never the date-only `endsAt`). Present
  // it and the stay's final continuation row grows a "Check Out" chip —
  // see `continuationCheckOutTime`.
  checkOutTime?: string;
  address?: string;
  // Where the geocoder put the stay. Seeds the matching `geocode_cache`
  // row so the card and the edit form read it as a hit without a live
  // lookup — the control case for a stay pinned by name alone (#135).
  pin?: { lat: number; lng: number; city?: string | null };
}

// Hotel segment — the span-capable type behind the collapsed-past
// continuation rows. A stay that checks in on a collapsed past day and
// runs through today surfaces as a "Staying since" row on the visible
// days (see day-temporal.ts `continuesThroughDay`).
export async function seedHotelSegment(tripId: string, values: SeedHotelValues): Promise<string> {
  assertTestDatabase();
  const data = {
    propertyName: values.propertyName,
    ...(values.address !== undefined && { address: values.address }),
    ...(values.checkOutTime !== undefined && { checkOutTime: values.checkOutTime }),
  };
  const inserted = await db
    .insert(segments)
    .values({
      tripId,
      type: 'hotel',
      data,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      locationName: values.locationName ?? null,
      countryCode: values.countryCode ?? null,
    })
    .returning({ id: segments.id });
  const row = inserted[0];
  if (!row) throw new Error('E2E fixture: failed to seed hotel segment.');

  if (values.pin) {
    await seedGeocodeHit(
      {
        type: 'hotel',
        data,
        locationName: values.locationName ?? null,
        countryCode: values.countryCode ?? null,
      },
      values.pin,
    );
  }
  return row.id;
}

// Cache a positive geocode for a place, keyed on the production
// buildGeocodeQuery output so the read path finds it.
async function seedGeocodeHit(
  place: Parameters<typeof buildGeocodeQuery>[0],
  pin: { lat: number; lng: number; city?: string | null },
): Promise<void> {
  const query = buildGeocodeQuery(place);
  if (!query) throw new Error('E2E fixture: buildGeocodeQuery returned null.');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const fields = {
    lat: pin.lat,
    lng: pin.lng,
    city: pin.city ?? null,
    displayName: query,
    source: 'photon',
    expiresAt,
  };
  await db
    .insert(geocodeCache)
    .values({ queryNormalized: normalizeQuery(query), ...fields })
    .onConflictDoUpdate({
      target: geocodeCache.queryNormalized,
      set: { ...fields, fetchedAt: new Date() },
    });
}

// The stored `data` JSONB of one segment. Lets a spec assert what a save
// actually wrote — e.g. that an edit did NOT persist a Plus Code derived
// from cached coordinates (#135).
export async function readSegmentData(segmentId: string): Promise<Record<string, unknown>> {
  assertTestDatabase();
  const rows = await db
    .select({ data: segments.data })
    .from(segments)
    .where(eq(segments.id, segmentId));
  const row = rows[0];
  if (!row) throw new Error('E2E fixture: segment not found.');
  return row.data as Record<string, unknown>;
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
    countryCode: values.countryCode ?? null,
  });
  if (!query) throw new Error('E2E fixture: buildGeocodeQuery returned null.');

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db
    .insert(geocodeCache)
    .values({
      queryNormalized: normalizeQuery(query),
      lat: values.lat,
      lng: values.lng,
      displayName: query,
      source: 'nominatim',
      expiresAt,
    })
    .onConflictDoUpdate({
      target: geocodeCache.queryNormalized,
      // The TTL is refreshed too: this key is fixed, and a row left by a
      // run more than a day ago would otherwise read as an expired miss.
      set: {
        lat: values.lat,
        lng: values.lng,
        displayName: query,
        fetchedAt: new Date(),
        expiresAt,
      },
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
      // No `locationName` — the cache key is the title plus the
      // country tail when `countryCode` is passed (ADR-0018), and the
      // seeding below derives it from the same fields it stores here.
      countryCode: values.countryCode ?? null,
    })
    .returning({ id: segments.id });
  const row = inserted[0];
  if (!row) throw new Error('E2E fixture: failed to seed ungeocoded segment.');

  const query = buildGeocodeQuery({
    type: 'activity',
    data: { title: values.title },
    locationName: null,
    countryCode: values.countryCode ?? null,
  });
  if (!query) throw new Error('E2E fixture: buildGeocodeQuery returned null for activity title.');

  // 1d is plenty for a test run. Refreshed on conflict as well, so a row
  // left behind by an older run never reads as an expired miss.
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db
    .insert(geocodeCache)
    .values({
      queryNormalized: normalizeQuery(query),
      lat: null,
      lng: null,
      displayName: null,
      source: 'nominatim',
      expiresAt,
    })
    .onConflictDoUpdate({
      target: geocodeCache.queryNormalized,
      set: { lat: null, lng: null, displayName: null, fetchedAt: new Date(), expiresAt },
    });

  return row.id;
}

type SeedTransitEnd = { lat: number; lng: number; source?: string } | 'null' | undefined;

export interface SeedTransitValues {
  mode: 'train' | 'bus' | 'ferry';
  fromName?: string;
  toName?: string;
  countryCode: string;
  startsAt?: Date;
  endsAt?: Date;
  // Per endpoint: coordinates seed a hit row, 'null' a negative row
  // (the geocoder found nothing), undefined no row at all (pending).
  // `source` overrides the row's provider — 'photon' or 'nominatim'
  // models a name the tagged station rungs missed and the free-text
  // ladder guessed at, which the trip map's distance guard reads.
  origin: SeedTransitEnd;
  destination: SeedTransitEnd;
}

// Train / bus / ferry segment with a geocode_cache row per endpoint
// (ADR-0019). The keys come from the production
// buildTransitEndpointQueries, so the trip-map repo reads each end
// exactly as seeded — hit, null, or missing — without a live Photon
// call. Hit rows mimic a station lookup: source 'photon-station', the
// typed name as the display name.
export async function seedTransitSegment(
  tripId: string,
  values: SeedTransitValues,
): Promise<string> {
  assertTestDatabase();
  const data = {
    mode: values.mode,
    ...(values.fromName !== undefined && { fromName: values.fromName }),
    ...(values.toName !== undefined && { toName: values.toName }),
  };
  const inserted = await db
    .insert(segments)
    .values({
      tripId,
      type: 'transit',
      data,
      startsAt: values.startsAt ?? null,
      endsAt: values.endsAt ?? null,
      countryCode: values.countryCode,
    })
    .returning({ id: segments.id });
  const row = inserted[0];
  if (!row) throw new Error('E2E fixture: failed to seed transit segment.');

  const queries = buildTransitEndpointQueries({
    type: 'transit',
    data,
    locationName: null,
    countryCode: values.countryCode,
  });
  if (!queries) throw new Error('E2E fixture: buildTransitEndpointQueries returned null.');

  const ends = [
    { query: queries.origin, seed: values.origin, name: values.fromName },
    { query: queries.destination, seed: values.destination, name: values.toName },
  ];
  for (const { query, seed, name } of ends) {
    if (seed === undefined) continue;
    if (!query) throw new Error('E2E fixture: a seeded transit endpoint has no geocode query.');
    const hit = seed === 'null' ? null : seed;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // 'none' is what the cache layer writes when every provider missed.
    const fields = {
      lat: hit?.lat ?? null,
      lng: hit?.lng ?? null,
      displayName: hit ? (name ?? null) : null,
      source: hit ? (hit.source ?? 'photon-station') : 'none',
      expiresAt,
    };
    await db
      .insert(geocodeCache)
      .values({ queryNormalized: normalizeQuery(query), ...fields })
      .onConflictDoUpdate({
        target: geocodeCache.queryNormalized,
        set: { ...fields, fetchedAt: new Date() },
      });
  }

  return row.id;
}
