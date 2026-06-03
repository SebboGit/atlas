// DB-integration test for search visibility scoping (ADR-0015). The
// sibling repo.test.ts mocks the DB to cover JS row-dispatch; this file
// runs the real CTE against Postgres to pin the visibility predicates that
// `searchAll` hand-writes as raw SQL — the one boundary NOT expressed via
// `tripVisibleToViewer`, and therefore the most likely to silently drift.
// Skipped cleanly when DATABASE_URL is unset, same pattern as the other
// describeIfDb repos.

import { randomUUID } from 'node:crypto';

import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { documents, segments, trips, users } from '@/db/schema';

import { searchAll } from './repo';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('searchAll visibility scoping', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let userA: string;
  let userB: string;

  // Unique single-token strings so the FTS prefix match only ever hits
  // this test's rows — unrelated (e.g. seeded) data has ~0 trigram
  // similarity and won't appear.
  const PRIV = 'zphantompriv' + randomUUID().replace(/-/g, '').slice(0, 8);
  const SHARE = 'zphantomshare' + randomUUID().replace(/-/g, '').slice(0, 8);

  const id: {
    privTrip?: string;
    privSeg?: string;
    privDoc?: string;
    shareTrip?: string;
    shareSeg?: string;
    shareDoc?: string;
  } = {};

  async function makeUser(): Promise<string> {
    const [u] = await db
      .insert(users)
      .values({ email: `search-${randomUUID()}@test.invalid`, sub: `sub-${randomUUID()}` })
      .returning({ id: users.id });
    if (!u) throw new Error('failed to insert test user');
    return u.id;
  }

  async function makeTrip(
    userId: string,
    visibility: 'household' | 'private',
    title: string,
  ): Promise<string> {
    const [t] = await db
      .insert(trips)
      .values({ userId, title, status: 'planned', visibility })
      .returning({ id: trips.id });
    if (!t) throw new Error('failed to insert test trip');
    return t.id;
  }

  async function makeSegment(tripId: string, locationName: string): Promise<string> {
    const [s] = await db
      .insert(segments)
      .values({ tripId, type: 'hotel', locationName, data: {} })
      .returning({ id: segments.id });
    if (!s) throw new Error('failed to insert test segment');
    return s.id;
  }

  async function makeDoc(userId: string, tripId: string, originalName: string): Promise<string> {
    const [d] = await db
      .insert(documents)
      .values({
        userId,
        tripId,
        originalName,
        objectKey: `2026/06/${randomUUID()}.pdf`,
        mime: 'application/pdf',
        bytes: 1,
        sha256: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
      })
      .returning({ id: documents.id });
    if (!d) throw new Error('failed to insert test document');
    return d.id;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    db = drizzle(pool);
    await pool.query('SELECT 1');

    userA = await makeUser();
    userB = await makeUser();

    // A private trip + its segment + its document, all owned by A.
    id.privTrip = await makeTrip(userA, 'private', `${PRIV} trip`);
    id.privSeg = await makeSegment(id.privTrip, `${PRIV} hotel`);
    id.privDoc = await makeDoc(userA, id.privTrip, `${PRIV}.pdf`);

    // A household trip + segment + document, created/owned by A.
    id.shareTrip = await makeTrip(userA, 'household', `${SHARE} trip`);
    id.shareSeg = await makeSegment(id.shareTrip, `${SHARE} hotel`);
    id.shareDoc = await makeDoc(userA, id.shareTrip, `${SHARE}.pdf`);
  });

  afterAll(async () => {
    // trips (→ segments) and documents both cascade on user delete.
    await db.delete(users).where(inArray(users.id, [userA, userB]));
    await pool.end();
  });

  it('hides a private trip, its segment, and its document from another member', async () => {
    const out = await searchAll(PRIV, userB);
    expect(out.trips.some((r) => r.id === id.privTrip)).toBe(false);
    expect(out.segments.some((r) => r.id === id.privSeg)).toBe(false);
    expect(out.documents.some((r) => r.id === id.privDoc)).toBe(false);
  });

  it('shows the owner their own private trip, segment, and document', async () => {
    const out = await searchAll(PRIV, userA);
    expect(out.trips.some((r) => r.id === id.privTrip)).toBe(true);
    expect(out.segments.some((r) => r.id === id.privSeg)).toBe(true);
    expect(out.documents.some((r) => r.id === id.privDoc)).toBe(true);
  });

  it('shows a household trip + segment to another member, but keeps its document uploader-scoped', async () => {
    const out = await searchAll(SHARE, userB);
    expect(out.trips.some((r) => r.id === id.shareTrip)).toBe(true);
    expect(out.segments.some((r) => r.id === id.shareSeg)).toBe(true);
    // The shared trip's document was uploaded by A; B's search is
    // owner-scoped, so it must not surface — search would otherwise
    // dangle a hit the download route (documents.userId) then 403s.
    expect(out.documents.some((r) => r.id === id.shareDoc)).toBe(false);
  });
});
