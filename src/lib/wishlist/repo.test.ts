// DB-integration tests for the wishlist repo. Skipped cleanly when
// DATABASE_URL is unset, same pattern as segments/repo.test.ts.
//
// Focused on the load-bearing behaviours:
//   - household-shared reads (no createdBy filter on list)
//   - per-trip exclusion in listForCountries (same item still surfaces
//     on OTHER trips after being added to one)
//   - materialiseOnTrip writes an undated segment with verbatim `data`
//     and the wishlistItemId provenance backref

import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { countries, trips, users, wishlistItems } from '@/db/schema';

import * as repo from './repo';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('wishlist.repo', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let userIdA: string;
  let userIdB: string;
  let tripA: string;
  let tripB: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    db = drizzle(pool);
    await pool.query('SELECT 1');
    // Ensure 'JP' exists in the countries reference table. Local dev
    // has seed data populated, but CI only runs migrations — so the
    // FK on wishlist_items.country_code would otherwise reject every
    // insert here. ON CONFLICT DO NOTHING keeps the local case a no-op.
    await db
      .insert(countries)
      .values({ code: 'JP', name: 'Japan' })
      .onConflictDoNothing({ target: countries.code });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Two users (household), two Japan trips owned by user A. Item
    // created by either user must surface on both trips.
    const [uA] = await db
      .insert(users)
      .values({
        email: `wishlist-A-${randomUUID()}@test.invalid`,
        sub: `sub-A-${randomUUID()}`,
      })
      .returning({ id: users.id });
    if (!uA) throw new Error('failed to insert user A');
    userIdA = uA.id;

    const [uB] = await db
      .insert(users)
      .values({
        email: `wishlist-B-${randomUUID()}@test.invalid`,
        sub: `sub-B-${randomUUID()}`,
      })
      .returning({ id: users.id });
    if (!uB) throw new Error('failed to insert user B');
    userIdB = uB.id;

    const [tA] = await db
      .insert(trips)
      .values({ userId: userIdA, title: 'Tokyo A', status: 'planned' })
      .returning({ id: trips.id });
    if (!tA) throw new Error('failed to insert trip A');
    tripA = tA.id;

    const [tB] = await db
      .insert(trips)
      .values({ userId: userIdA, title: 'Kyoto B', status: 'planned' })
      .returning({ id: trips.id });
    if (!tB) throw new Error('failed to insert trip B');
    tripB = tB.id;
  });

  describe('list', () => {
    it('returns items household-shared, regardless of who created them', async () => {
      const foodItem = await repo.create(userIdA, {
        type: 'food',
        countryCode: 'JP',
        data: { venue: 'Ramen Ichiraku' },
        tags: [],
      });
      const activityItem = await repo.create(userIdB, {
        type: 'activity',
        countryCode: 'JP',
        data: { title: 'Senso-ji' },
        tags: [],
      });

      // No userId on list — household-shared by design. Identify our
      // rows by id so stale rows from prior tests don't bleed in
      // (wishlist_items doesn't cascade on user delete).
      const all = await repo.list();
      const ids = new Set(all.map((i) => i.id));
      expect(ids.has(foodItem.id)).toBe(true);
      expect(ids.has(activityItem.id)).toBe(true);
      const mine = all.filter((i) => i.id === foodItem.id || i.id === activityItem.id);
      expect(mine.map((i) => i.type).sort()).toEqual(['activity', 'food']);
    });

    it('filters by type', async () => {
      await repo.create(userIdA, {
        type: 'food',
        countryCode: 'JP',
        data: { venue: 'A' },
        tags: [],
      });
      await repo.create(userIdA, {
        type: 'activity',
        countryCode: 'JP',
        data: { title: 'B' },
        tags: [],
      });

      const foods = await repo.list({ type: 'food', countryCode: 'JP' });
      expect(foods.every((i) => i.type === 'food')).toBe(true);
    });
  });

  describe('listForCountries — per-trip exclusion', () => {
    it('hides items already materialised on this trip but keeps suggesting on OTHER trips', async () => {
      const item = await repo.create(userIdA, {
        type: 'food',
        countryCode: 'JP',
        data: { venue: 'Ramen Ichiraku' },
        tags: [],
      });

      // Materialise on trip A only.
      await repo.materialiseOnTrip(userIdA, item.id, tripA);

      // On trip A: excluded.
      const suggestionsA = await repo.listForCountries(['JP'], {
        excludeMaterialisedOnTrip: tripA,
      });
      expect(suggestionsA.find((i) => i.id === item.id)).toBeUndefined();

      // On trip B: still present.
      const suggestionsB = await repo.listForCountries(['JP'], {
        excludeMaterialisedOnTrip: tripB,
      });
      expect(suggestionsB.find((i) => i.id === item.id)).toBeDefined();
    });

    it('returns an empty array when no country codes are passed', async () => {
      const out = await repo.listForCountries([]);
      expect(out).toEqual([]);
    });
  });

  describe('materialiseOnTrip', () => {
    it('writes an undated segment with verbatim data and wishlistItemId backref', async () => {
      const item = await repo.create(userIdA, {
        type: 'food',
        countryCode: 'JP',
        locationName: 'Ginza',
        data: { venue: 'Ramen Ichiraku', address: '1-2-3 Ginza, Tokyo' },
        tags: [],
      });

      const { segment } = await repo.materialiseOnTrip(userIdA, item.id, tripA);
      expect(segment.type).toBe('food');
      expect(segment.startsAt).toBeNull();
      expect(segment.endsAt).toBeNull();
      expect(segment.locationName).toBe('Ginza');
      expect(segment.countryCode).toBe('JP');
      expect(segment.originCountryCode).toBeNull();
      expect(segment.wishlistItemId).toBe(item.id);
      expect(segment.data).toEqual({
        venue: 'Ramen Ichiraku',
        address: '1-2-3 Ginza, Tokyo',
      });
    });

    it('throws TRIP_NOT_FOUND when the trip does not belong to the user', async () => {
      const item = await repo.create(userIdA, {
        type: 'activity',
        countryCode: 'JP',
        data: { title: 'Senso-ji' },
        tags: [],
      });

      // userIdB does not own trip A.
      await expect(repo.materialiseOnTrip(userIdB, item.id, tripA)).rejects.toThrow(
        'TRIP_NOT_FOUND',
      );
    });

    it('throws WISHLIST_ITEM_NOT_FOUND when the item does not exist', async () => {
      await expect(repo.materialiseOnTrip(userIdA, randomUUID(), tripA)).rejects.toThrow(
        'WISHLIST_ITEM_NOT_FOUND',
      );
    });

    it('preserves the segment when the wishlist item is deleted', async () => {
      const item = await repo.create(userIdA, {
        type: 'food',
        countryCode: 'JP',
        data: { venue: 'Ramen Ichiraku' },
        tags: [],
      });
      const { segment } = await repo.materialiseOnTrip(userIdA, item.id, tripA);

      await repo.remove(item.id);

      // Re-fetch the segment row directly to confirm survival and the
      // ON DELETE SET NULL on wishlistItemId.
      const { segments } = await import('@/db/schema');
      const { eq } = await import('drizzle-orm');
      const rows = await db.select().from(segments).where(eq(segments.id, segment.id)).limit(1);
      expect(rows.length).toBe(1);
      expect(rows[0]?.wishlistItemId).toBeNull();
      expect(rows[0]?.data).toEqual({ venue: 'Ramen Ichiraku' });
    });
  });

  describe('searchable fields', () => {
    it('persists notes and tags', async () => {
      const item = await repo.create(userIdA, {
        type: 'food',
        countryCode: 'JP',
        notes: 'Best ramen in Tokyo per reviewers.',
        tags: ['ramen', 'tokyo'],
        data: { venue: 'Ichiraku' },
      });
      expect(item.notes).toBe('Best ramen in Tokyo per reviewers.');
      expect(item.tags).toEqual(['ramen', 'tokyo']);

      // Sanity: row should be visible through the schema's search_tsv
      // column even though we don't assert ranking here.
      const rows = await db
        .select({ id: wishlistItems.id, tsv: wishlistItems.searchTsv })
        .from(wishlistItems);
      const found = rows.find((r) => r.id === item.id);
      expect(found?.tsv).toBeTruthy();
    });
  });
});
