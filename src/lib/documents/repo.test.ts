import { randomBytes, randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { documents, trips, users } from '@/db/schema';

import { create, getByIdForUser, type CreateDocumentInput } from './repo';

const DATABASE_URL = process.env.DATABASE_URL;

// Skip cleanly when no DB is reachable — mirrors jit-user.test.ts so
// the unit suite stays green without a Postgres container.
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function uniqueSha(): string {
  // 64-hex-char string that's unique per call. The sha256 column is
  // text — value content doesn't matter, only uniqueness against
  // other tests in the same run.
  return randomBytes(32).toString('hex');
}

function uniqueObjectKey(): string {
  return `2026/01/${randomUUID()}.pdf`;
}

describeIfDb('documents.repo.create — ON CONFLICT idempotency', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    db = drizzle(pool);
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Fresh user + trip per test. Cascade-on-delete from users to
    // trips and documents (via userId) makes cleanup unnecessary —
    // we just leak rows tagged with the unique fixture email, same
    // pattern as the auth integration suite.
    const [u] = await db
      .insert(users)
      .values({ email: `docs-test-${randomUUID()}@example.invalid` })
      .returning({ id: users.id });
    expect(u?.id).toBeTruthy();
    userId = u!.id;

    const [t] = await db
      .insert(trips)
      .values({ userId, title: `Docs test ${randomUUID()}` })
      .returning({ id: trips.id });
    expect(t?.id).toBeTruthy();
    tripId = t!.id;
  });

  function fixture(overrides: Partial<CreateDocumentInput> = {}): CreateDocumentInput {
    return {
      tripId,
      objectKey: uniqueObjectKey(),
      mime: 'application/pdf',
      bytes: 1234,
      sha256: uniqueSha(),
      originalName: 'boarding-pass.pdf',
      ...overrides,
    };
  }

  it('first insert is new and binds tripId + userId', async () => {
    const { document, isNew } = await create(userId, fixture());
    expect(isNew).toBe(true);
    expect(document.userId).toBe(userId);
    expect(document.tripId).toBe(tripId);
  });

  it('second insert with same (userId, sha256) returns existing row, isNew:false', async () => {
    const sha = uniqueSha();
    const first = await create(userId, fixture({ sha256: sha }));
    const second = await create(userId, fixture({ sha256: sha, objectKey: uniqueObjectKey() }));

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.document.id).toBe(first.document.id);
    // Crucially: the existing row's objectKey wins. The caller is
    // responsible for cleaning up the orphan file under the new key.
    expect(second.document.objectKey).toBe(first.document.objectKey);
  });

  it('different sha256 produces a new row', async () => {
    const a = await create(userId, fixture({ sha256: uniqueSha() }));
    const b = await create(userId, fixture({ sha256: uniqueSha() }));
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(true);
    expect(a.document.id).not.toBe(b.document.id);
  });

  it('same sha256 across different users does NOT collide', async () => {
    // The unique constraint is per-user (documents_user_sha256_uq).
    // Two users can each have a doc for the same content.
    const sha = uniqueSha();
    const [u2] = await db
      .insert(users)
      .values({ email: `docs-test-${randomUUID()}@example.invalid` })
      .returning({ id: users.id });
    const [t2] = await db
      .insert(trips)
      .values({ userId: u2!.id, title: 'second user trip' })
      .returning({ id: trips.id });

    const a = await create(userId, fixture({ sha256: sha }));
    const b = await create(u2!.id, fixture({ tripId: t2!.id, sha256: sha }));

    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(true);
    expect(a.document.id).not.toBe(b.document.id);
  });

  it('simulated upload race — pre-inserted row makes ON CONFLICT return isNew:false', async () => {
    // Mimic the race: another concurrent request wrote the row
    // between our pre-check and our INSERT. The fix uses
    // ON CONFLICT DO NOTHING RETURNING so create() must resolve
    // without throwing and return the pre-existing row.
    const sha = uniqueSha();
    const priorKey = uniqueObjectKey();
    const [existing] = await db
      .insert(documents)
      .values({
        userId,
        tripId,
        objectKey: priorKey,
        mime: 'application/pdf',
        bytes: 99,
        sha256: sha,
        originalName: 'prior.pdf',
      })
      .returning();
    expect(existing?.id).toBeTruthy();

    const { document, isNew } = await create(userId, fixture({ sha256: sha }));

    expect(isNew).toBe(false);
    expect(document.id).toBe(existing!.id);
    expect(document.objectKey).toBe(priorKey);
    expect(document.originalName).toBe('prior.pdf');
  });

  it('different objectKey + same sha256 still resolves to the existing row', async () => {
    // The objectKey is generated by the storage adapter from a fresh
    // UUID on every upload — so even truly-identical content uploads
    // produce a different `put.key` each time. The dedup gate is the
    // unique index on (userId, sha256), not on objectKey.
    const sha = uniqueSha();
    const a = await create(userId, fixture({ sha256: sha }));
    const b = await create(
      userId,
      fixture({ sha256: sha, objectKey: uniqueObjectKey(), originalName: 'second-attempt.pdf' }),
    );
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(false);
    expect(b.document.id).toBe(a.document.id);
    expect(b.document.originalName).toBe(a.document.originalName); // unchanged
  });
});

describeIfDb('documents.repo.getByIdForUser — user scoping', () => {
  // This is the access-control predicate behind the /api/documents/[id]
  // download route: the route 404s whenever this returns null, so the
  // `WHERE user_id = ...` clause is the only thing stopping one user from
  // pulling another user's file by guessing its id. The route's own test
  // (src/app/api/documents/[id]/route.test.ts) mocks this out; here we
  // exercise the real SQL.
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

  async function makeUserWithTrip(): Promise<{ userId: string; tripId: string }> {
    const [u] = await db
      .insert(users)
      .values({ email: `docs-scope-${randomUUID()}@example.invalid` })
      .returning({ id: users.id });
    const [t] = await db
      .insert(trips)
      .values({ userId: u!.id, title: `scope ${randomUUID()}` })
      .returning({ id: trips.id });
    return { userId: u!.id, tripId: t!.id };
  }

  it('returns the document for its owner but null for another user', async () => {
    const owner = await makeUserWithTrip();
    const stranger = await makeUserWithTrip();
    const { document } = await create(owner.userId, {
      tripId: owner.tripId,
      objectKey: uniqueObjectKey(),
      mime: 'application/pdf',
      bytes: 1234,
      sha256: uniqueSha(),
      originalName: 'boarding-pass.pdf',
    });

    expect((await getByIdForUser(owner.userId, document.id))?.id).toBe(document.id);
    // The whole point: a different user gets nothing back, even with the
    // real document id — so the route can only ever 404 for them.
    expect(await getByIdForUser(stranger.userId, document.id)).toBeNull();
  });

  it('returns null for an id that does not exist', async () => {
    const owner = await makeUserWithTrip();
    expect(await getByIdForUser(owner.userId, randomUUID())).toBeNull();
  });
});
