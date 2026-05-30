// DB-integration tests for the countries repo. Skipped cleanly when
// DATABASE_URL is unset, same pattern as wishlist/repo.test.ts and
// segments/repo.test.ts. Covers the visited-country roll-up that feeds
// the /map world choropleth:
//   - non-flight segments on a started trip count
//   - flight segments are excluded
//   - manual marks surface with zero trip count
//   - results are scoped to the requesting user

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
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
    await db
      .insert(countries)
      .values([
        { code: 'JP', name: 'Japan' },
        { code: 'FR', name: 'France' },
        { code: 'GB', name: 'United Kingdom' },
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

  async function startedTrip(userId: string): Promise<string> {
    const [t] = await db
      .insert(trips)
      .values({
        userId,
        title: 'Fixture',
        status: 'completed',
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
      countryCode: 'JP',
      startsAt: new Date('2020-01-02T00:00:00Z'),
    });

    const visited = await listVisitedCountriesForUser(userId);
    expect(visited).toHaveLength(1);
    expect(visited[0]?.code).toBe('JP');
    expect(visited[0]?.tripCount).toBe(1);
    expect(visited[0]?.manuallyMarked).toBe(false);
  });

  it('excludes flight segments from the roll-up', async () => {
    const userId = await makeUser();
    const tripId = await startedTrip(userId);
    await db.insert(segments).values({
      tripId,
      type: 'flight',
      countryCode: 'FR',
      startsAt: new Date('2020-01-02T00:00:00Z'),
    });

    const visited = await listVisitedCountriesForUser(userId);
    expect(visited).toHaveLength(0);
  });

  it('surfaces a manual mark with zero trip count', async () => {
    const userId = await makeUser();
    await addManualVisitedCountry(userId, 'GB');

    const visited = await listVisitedCountriesForUser(userId);
    expect(visited).toHaveLength(1);
    expect(visited[0]?.code).toBe('GB');
    expect(visited[0]?.tripCount).toBe(0);
    expect(visited[0]?.manuallyMarked).toBe(true);

    await db.delete(userVisitedCountries).where(eq(userVisitedCountries.userId, userId));
  });

  it('scopes results to the requesting user', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const tripA = await startedTrip(userA);
    await db.insert(segments).values({
      tripId: tripA,
      type: 'activity',
      countryCode: 'JP',
      startsAt: new Date('2020-01-02T00:00:00Z'),
    });

    const visitedB = await listVisitedCountriesForUser(userB);
    expect(visitedB).toHaveLength(0);
  });
});
