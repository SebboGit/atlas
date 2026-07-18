import { randomBytes, randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { documentSegments, documents, segments, trips, users } from '@/db/schema';

import { hardDeleteIfUnreferenced } from '@/lib/segments/repo';

import {
  create,
  getByIdForUser,
  listLinkedSegmentIds,
  listSegmentLinkOptions,
  markExtractionStarted,
  rename,
  setManualLink,
  type CreateDocumentInput,
} from './repo';

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

  it('rename sets, clears, and stays uploader-scoped', async () => {
    const owner = await makeUserWithTrip();
    const stranger = await makeUserWithTrip();
    const { document } = await create(owner.userId, {
      tripId: owner.tripId,
      objectKey: uniqueObjectKey(),
      mime: 'application/pdf',
      bytes: 1234,
      sha256: uniqueSha(),
      originalName: 'gc-2039479-confirmation-final3.pdf',
    });

    const renamed = await rename(owner.userId, document.id, 'Marriott Tokyo confirmation');
    expect(renamed?.title).toBe('Marriott Tokyo confirmation');
    // originalName is immutable — the rename never touches it.
    expect(renamed?.originalName).toBe('gc-2039479-confirmation-final3.pdf');

    // Same scoping contract as getByIdForUser: another user's rename
    // matches no row and must not change the title.
    expect(await rename(stranger.userId, document.id, 'hijacked')).toBeNull();
    expect((await getByIdForUser(owner.userId, document.id))?.title).toBe(
      'Marriott Tokyo confirmation',
    );

    // null clears the custom title (display falls back to originalName).
    const cleared = await rename(owner.userId, document.id, null);
    expect(cleared?.title).toBeNull();
  });
});

describeIfDb('documents.repo — manual segment links (#103)', () => {
  // Manual links live outside the re-extract lifecycle: a re-extract
  // wipes and orphan-sweeps only extraction-created rows, so a
  // hand-linked, hand-made segment must be untouchable from here.
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
    const [u] = await db
      .insert(users)
      .values({ email: `docs-links-${randomUUID()}@example.invalid` })
      .returning({ id: users.id });
    userId = u!.id;
    const [t] = await db
      .insert(trips)
      .values({ userId, title: `links ${randomUUID()}` })
      .returning({ id: trips.id });
    tripId = t!.id;
  });

  async function makeSegment(forTripId = tripId): Promise<string> {
    const [s] = await db
      .insert(segments)
      .values({ tripId: forTripId, type: 'hotel', data: { propertyName: 'Test Hotel' } })
      .returning({ id: segments.id });
    return s!.id;
  }

  async function makeDoc(): Promise<string> {
    const { document } = await create(userId, {
      tripId,
      objectKey: uniqueObjectKey(),
      mime: 'application/pdf',
      bytes: 1,
      sha256: uniqueSha(),
      originalName: 'voucher.pdf',
    });
    return document.id;
  }

  async function linkSource(documentId: string, segmentId: string): Promise<string | undefined> {
    const [row] = await db
      .select({ source: documentSegments.source })
      .from(documentSegments)
      .where(
        and(eq(documentSegments.documentId, documentId), eq(documentSegments.segmentId, segmentId)),
      );
    return row?.source;
  }

  it('attach writes a manual row, detach removes it, and scoping holds', async () => {
    const docId = await makeDoc();
    const segId = await makeSegment();

    expect(await setManualLink(userId, docId, segId, true)).toBe(true);
    expect(await linkSource(docId, segId)).toBe('manual');

    // Stranger can neither attach nor detach.
    const [stranger] = await db
      .insert(users)
      .values({ email: `docs-links-${randomUUID()}@example.invalid` })
      .returning({ id: users.id });
    expect(await setManualLink(stranger!.id, docId, segId, false)).toBe(false);
    expect(await linkSource(docId, segId)).toBe('manual');

    expect(await setManualLink(userId, docId, segId, false)).toBe(true);
    expect(await linkSource(docId, segId)).toBeUndefined();
  });

  it('attach over an existing extraction row keeps it extraction-owned', async () => {
    const docId = await makeDoc();
    const segId = await makeSegment();
    await db
      .insert(documentSegments)
      .values({ documentId: docId, segmentId: segId, source: 'extraction' });

    expect(await setManualLink(userId, docId, segId, true)).toBe(true);
    expect(await linkSource(docId, segId)).toBe('extraction');
  });

  it('refuses a segment from a different trip', async () => {
    const docId = await makeDoc();
    const [otherTrip] = await db
      .insert(trips)
      .values({ userId, title: `other ${randomUUID()}` })
      .returning({ id: trips.id });
    const foreignSegId = await makeSegment(otherTrip!.id);

    expect(await setManualLink(userId, docId, foreignSegId, true)).toBe(false);
    expect(await linkSource(docId, foreignSegId)).toBeUndefined();
  });

  it('markExtractionStarted wipes and snapshots only extraction links', async () => {
    const docId = await makeDoc();
    const extractionSeg = await makeSegment();
    const manualSeg = await makeSegment();
    await db
      .insert(documentSegments)
      .values({ documentId: docId, segmentId: extractionSeg, source: 'extraction' });
    expect(await setManualLink(userId, docId, manualSeg, true)).toBe(true);

    const result = await markExtractionStarted(userId, docId);
    expect(result?.priorLinkedSegmentIds).toEqual([extractionSeg]);
    // The manual link survives the wipe; the extraction link is gone.
    expect(await linkSource(docId, manualSeg)).toBe('manual');
    expect(await linkSource(docId, extractionSeg)).toBeUndefined();
    // The bridge's idempotency view (extraction-only) is now empty even
    // though a manual link exists — a re-extract proceeds normally.
    expect(await listLinkedSegmentIds(userId, docId, { source: 'extraction' })).toEqual([]);
    expect(await listLinkedSegmentIds(userId, docId)).toEqual([manualSeg]);
  });

  it('hardDeleteIfUnreferenced spares a segment any document still links', async () => {
    const docId = await makeDoc();
    const segId = await makeSegment();
    await setManualLink(userId, docId, segId, true);

    // Still referenced (by the manual link) -> kept in place.
    expect(await hardDeleteIfUnreferenced(userId, segId)).toBe(false);
    const [still] = await db
      .select({ id: segments.id })
      .from(segments)
      .where(eq(segments.id, segId));
    expect(still?.id).toBe(segId);

    // Unlink, then the same call deletes it.
    await setManualLink(userId, docId, segId, false);
    expect(await hardDeleteIfUnreferenced(userId, segId)).toBe(true);
  });

  it('listSegmentLinkOptions flags only links to the given segment', async () => {
    const docA = await makeDoc();
    const docB = await makeDoc();
    const segId = await makeSegment();
    const otherSeg = await makeSegment();
    await setManualLink(userId, docA, segId, true);
    await setManualLink(userId, docB, otherSeg, true);

    const options = await listSegmentLinkOptions(userId, tripId, segId);
    const byId = new Map(options.map((o) => [o.id, o.linked]));
    expect(byId.get(docA)).toBe(true);
    // Linked elsewhere ≠ linked here — docB still shows attachable.
    expect(byId.get(docB)).toBe(false);
  });
});
