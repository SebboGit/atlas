// DB-integration tests for the trip visibility boundary (ADR-0015):
// `tripVisibleToViewer` drives every content read, while trip-row
// mutations stay owner-only. Skipped cleanly when DATABASE_URL is unset,
// same pattern as countries/repo.test.ts and segments/repo.test.ts.
//
// Assertions are membership-based (does the result contain / exclude a
// specific trip id) rather than exact-count: household trips are globally
// visible on the shared CI database, so an exact count would be fragile
// against rows other tests leave behind.

import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { trips, users } from '@/db/schema';

import { archive, getByIdForUser, hardDelete, listForUser, update } from './repo';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('trips.repo visibility boundary', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    db = drizzle(pool);
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await pool.end();
  });

  async function makeUser(): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({ email: `trips-${randomUUID()}@test.invalid`, sub: `sub-${randomUUID()}` })
      .returning({ id: users.id });
    if (!u) throw new Error('failed to insert test user');
    return u.id;
  }

  async function makeTrip(userId: string, visibility: 'household' | 'private'): Promise<string> {
    const [t] = await db
      .insert(trips)
      .values({ userId, title: 'Boundary fixture', status: 'planned', visibility })
      .returning({ id: trips.id });
    if (!t) throw new Error('failed to insert test trip');
    return t.id;
  }

  it('getByIdForUser shows a household trip to a non-owner but hides a private one', async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const household = await makeTrip(owner, 'household');
    const priv = await makeTrip(owner, 'private');

    expect(await getByIdForUser(viewer, household)).not.toBeNull();
    expect(await getByIdForUser(viewer, priv)).toBeNull();
    // The owner always reaches their own private trip.
    expect(await getByIdForUser(owner, priv)).not.toBeNull();
  });

  it('listForUser includes shared + own-private trips and excludes another member’s private', async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const ownerHousehold = await makeTrip(owner, 'household');
    const ownerPrivate = await makeTrip(owner, 'private');
    const viewerPrivate = await makeTrip(viewer, 'private');

    const ids = new Set((await listForUser(viewer)).map((t) => t.id));
    expect(ids.has(ownerHousehold)).toBe(true); // shared with the household
    expect(ids.has(viewerPrivate)).toBe(true); // viewer's own private trip
    expect(ids.has(ownerPrivate)).toBe(false); // another member's private trip
  });

  it('keeps trip-row mutations owner-only even on a household trip', async () => {
    const owner = await makeUser();
    const intruder = await makeUser();
    const household = await makeTrip(owner, 'household');

    // A household member can READ a shared trip (covered above) but cannot
    // edit / archive / delete the trip row — those stay owner-only.
    expect(await update(intruder, household, { title: 'Hijacked' })).toBeNull();
    expect(await archive(intruder, household)).toBeNull();
    expect(await hardDelete(intruder, household)).toBe(false);

    // The owner can.
    expect(await update(owner, household, { title: 'Renamed' })).not.toBeNull();
  });
});
