// One-off fixture for visual smoke screenshots. Not used in CI / e2e.
// Creates (or reuses) a test user + valid Auth.js DB session and a few
// trips spanning the four statuses + date shapes. Prints the
// sessionToken to stdout so the capture script can drop it into a
// browser cookie.

import { randomBytes, randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { sessions, trips, users } from '../src/db/schema';

const FIXTURE_SUB = 'screenshot-fixture-user';
const FIXTURE_EMAIL = 'screenshot@atlas.local';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  try {
    // 1) User: upsert by sub.
    const existing = await db.select().from(users).where(eq(users.sub, FIXTURE_SUB)).limit(1);
    let userId: string;
    if (existing[0]) {
      userId = existing[0].id;
    } else {
      const [row] = await db
        .insert(users)
        .values({
          sub: FIXTURE_SUB,
          email: FIXTURE_EMAIL,
          name: 'Atlas Demo User',
          emailVerified: new Date(),
        })
        .returning({ id: users.id });
      if (!row) throw new Error('user insert returned no row');
      userId = row.id;
    }

    // 2) Wipe any previous fixture trips for a clean visual.
    await db.delete(trips).where(eq(trips.userId, userId));

    // 3) Seed three trips spanning shapes / statuses.
    await db.insert(trips).values([
      {
        userId,
        title: 'Lisbon, slowly',
        summary:
          'A long weekend tracing tilework, miradouros, and pastel de nata. Notebook trip — keep the itinerary loose, follow the trams uphill.',
        status: 'planned',
        startDate: new Date(Date.UTC(2026, 5, 12)),
        endDate: new Date(Date.UTC(2026, 5, 16)),
      },
      {
        userId,
        title: 'Tokyo · spring',
        summary: 'Cherry blossoms in Ueno, ramen crawl through Shinjuku, a day in Kamakura.',
        status: 'active',
        startDate: new Date(Date.UTC(2026, 3, 2)),
        endDate: new Date(Date.UTC(2026, 3, 11)),
      },
      {
        userId,
        title: 'Reykjavík ring road',
        summary: 'Ten days, one rented Dacia, every waterfall the camera could hold.',
        status: 'completed',
        startDate: new Date(Date.UTC(2025, 8, 4)),
        endDate: new Date(Date.UTC(2025, 8, 14)),
      },
    ]);

    // 4) Fresh session for the headless browser. Auth.js's default
    //    session token is an opaque random string, NOT a JWT.
    await db.delete(sessions).where(eq(sessions.userId, userId));
    const sessionToken = `screenshot.${randomUUID()}.${randomBytes(16).toString('hex')}`;
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(sessions).values({ sessionToken, userId, expires });

    // 5) Re-read the trips so the capture script can build deep links
    //    without parsing IDs from the page.
    const persisted = await db
      .select({ id: trips.id, title: trips.title, status: trips.status })
      .from(trips)
      .where(eq(trips.userId, userId))
      .orderBy(sql`${trips.startDate} desc nulls last`);

    process.stdout.write(
      JSON.stringify({ sessionToken, userId, trips: persisted }, null, 2) + '\n',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
