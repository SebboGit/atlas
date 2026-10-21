// DB-integration tests for notification settings. Skipped cleanly when
// DATABASE_URL is unset, same pattern as trips/repo.test.ts.

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { trips, users } from '@/db/schema';

import { getNotificationSettings, tripForNotification, updateNotificationSettings } from './repo';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('notifications.repo', () => {
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
      .values({ email: `notify-${randomUUID()}@test.invalid`, sub: `sub-${randomUUID()}` })
      .returning({ id: users.id });
    if (!u) throw new Error('failed to insert test user');
    return u.id;
  }

  it('reads a new user as opted out, default topic, every category on', async () => {
    const userId = await makeUser();
    expect(await getNotificationSettings(userId)).toEqual({
      enabled: false,
      topic: null,
      prefs: { extraction: true },
    });
  });

  it('round-trips saved settings', async () => {
    const userId = await makeUser();
    await updateNotificationSettings(userId, {
      enabled: true,
      topic: 'mine',
      prefs: { extraction: false },
    });
    expect(await getNotificationSettings(userId)).toEqual({
      enabled: true,
      topic: 'mine',
      prefs: { extraction: false },
    });
  });

  it('returns null for an unknown user', async () => {
    expect(await getNotificationSettings(randomUUID())).toBeNull();
  });

  it("names a household trip but not someone else's private one", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const [household] = await db
      .insert(trips)
      .values({ userId: owner, title: 'Shared', status: 'planned', visibility: 'household' })
      .returning({ id: trips.id });
    const [priv] = await db
      .insert(trips)
      .values({ userId: owner, title: 'Mine only', status: 'planned', visibility: 'private' })
      .returning({ id: trips.id });

    expect(await tripForNotification(other, household!.id)).toEqual({
      title: 'Shared',
      isPrivate: false,
    });
    expect(await tripForNotification(other, priv!.id)).toBeNull();
    expect(await tripForNotification(owner, priv!.id)).toEqual({
      title: 'Mine only',
      isPrivate: true,
    });

    await db.delete(trips).where(eq(trips.userId, owner));
  });
});
