// DB-integration tests for the countries repo. Skipped cleanly when
// DATABASE_URL is unset, same pattern as wishlist/repo.test.ts and
// segments/repo.test.ts. Covers the visited-country roll-up that feeds
// the /map world choropleth:
//   - non-flight segments on a started trip count
//   - flight segments are excluded
//   - manual marks surface with zero trip count
//   - results are scoped to the requesting user

import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { countries, segments, trips, userVisitedCountries, users } from '@/db/schema';

import { addManualVisitedCountry, listVisitedCountriesForUser } from './repo';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('countries.repo.listVisitedCountriesForUser', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    db = drizzle(pool);
    await pool.query('SELECT 1');
    // CI runs migrations only (no seed), so the FK on
    // segments.country_code / user_visited_countries.country_code would
    // otherwise reject every insert. ON CONFLICT keeps local dev a no-op.
    // These codes are deliberately ones the dev fixture never uses, so the
    // membership assertions below stay robust even against a seeded DB
    // where household trips (ADR-0015) are now globally visible.
    await db
      .insert(countries)
      .values([
        { code: 'NZ', name: 'New Zealand' },
        { code: 'IS', name: 'Iceland' },
        { code: 'NO', name: 'Norway' },
        { code: 'SE', name: 'Sweden' },
        { code: 'DK', name: 'Denmark' },
      ])
      .onConflictDoNothing({ target: countries.code });
  });

  afterAll(async () => {
    await pool.end();
  });

  // Fresh user per test; cascade-on-delete from users cleans up trips +
  // segments. Manual marks don't cascade, so we clear them explicitly.
  async function makeUser(): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({
        email: `countries-${randomUUID()}@test.invalid`,
        sub: `sub-${randomUUID()}`,
      })
      .returning({ id: users.id });
    if (!u) throw new Error('failed to insert test user');
    return u.id;
  }

  // Default 'private' keeps each test's roll-up isolated. Under household
  // sharing (ADR-0015) a 'household' trip is visible to EVERY user, so on
  // the shared CI database these tests would otherwise contaminate each
  // other's exact-count assertions. Pass 'household' to exercise sharing.
  async function startedTrip(
    userId: string,
    visibility: 'household' | 'private' = 'private',
  ): Promise<string> {
    const [t] = await db
      .insert(trips)
      .values({
        userId,
        title: 'Fixture',
        status: 'completed',
        visibility,
        // Past start so the trip counts as "actually started".
        startDate: new Date('2020-01-01T00:00:00Z'),
      })
      .returning({ id: trips.id });
    if (!t) throw new Error('failed to insert test trip');
    return t.id;
  }

  it('rolls up a non-flight segment on a started trip', async () => {
    const userId = await makeUser();
    const tripId = await startedTrip(userId);
    await db.insert(segments).values({
      tripId,
      type: 'hotel',
      countryCode: 'NZ',
      startsAt: new Date('2020-01-02T00:00:00Z'),
    });

    // Membership, not exact-count: a seeded DB carries household trips that
    // are globally visible now (ADR-0015), so assert on this test's own
    // unique code rather than the total length.
    const nz = (await listVisitedCountriesForUser(userId)).find((v) => v.code === 'NZ');
    expect(nz).toBeDefined();
    expect(nz?.tripCount).toBe(1);
    expect(nz?.manuallyMarked).toBe(false);
  });

  it('excludes flight segments from the roll-up', async () => {
    const userId = await makeUser();
    const tripId = await startedTrip(userId);
    await db.insert(segments).values({
      tripId,
      type: 'flight',
      countryCode: 'IS',
      startsAt: new Date('2020-01-02T00:00:00Z'),
    });

    // The flight's country must not appear: logging a flight doesn't count
    // as visiting. IS is used by no other (visible) trip.
    const visited = await listVisitedCountriesForUser(userId);
    expect(visited.find((v) => v.code === 'IS')).toBeUndefined();
  });

  it('surfaces a manual mark with zero trip count', async () => {
    const userId = await makeUser();
    await addManualVisitedCountry(userId, 'NO');

    // Manual marks are per-user, so NO is this user's alone.
    const no = (await listVisitedCountriesForUser(userId)).find((v) => v.code === 'NO');
    expect(no).toBeDefined();
    expect(no?.tripCount).toBe(0);
    expect(no?.manuallyMarked).toBe(true);

    await db.delete(userVisitedCountries).where(eq(userVisitedCountries.userId, userId));
  });

  it('does not leak another member’s private trip', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const tripA = await startedTrip(userA); // private by default
    await db.insert(segments).values({
      tripId: tripA,
      type: 'activity',
      countryCode: 'SE',
      startsAt: new Date('2020-01-02T00:00:00Z'),
    });

    // A's trip is private and SE is on no other visible trip, so it must
    // not paint a country on another household member's map (ADR-0015).
    const visitedB = await listVisitedCountriesForUser(userB);
    expect(visitedB.find((v) => v.code === 'SE')).toBeUndefined();
  });

  it('counts a household trip created by another member', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const tripA = await startedTrip(userA, 'household');
    await db.insert(segments).values({
      tripId: tripA,
      type: 'activity',
      countryCode: 'DK',
      startsAt: new Date('2020-01-02T00:00:00Z'),
    });

    // Household trips are shared, so A's Denmark trip surfaces on B's map.
    const visitedB = await listVisitedCountriesForUser(userB);
    expect(visitedB.map((v) => v.code)).toContain('DK');

    // A household trip is globally visible, so leaving it in the shared DB
    // would bleed into other roll-up assertions. Cascade-delete both users
    // to remove the trip + its segment.
    await db.delete(users).where(inArray(users.id, [userA, userB]));
  });
});
