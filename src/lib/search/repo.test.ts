// Pinned-down behaviour of `searchAll`. The query itself is a single
// raw SQL CTE — these tests don't try to validate the SQL, only the
// pieces the JS side owns: empty-input short-circuit, row-to-group
// dispatch, and SegmentSubtype passthrough.
//
// Postgres FTS ranking is best covered by an integration harness against
// a real DB, which doesn't exist yet (deferred — see search-slice-handoff).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  rows: [] as Array<{
    type: 'trip' | 'segment' | 'document' | 'wishlist';
    segment_type: string | null;
    wishlist_type: 'food' | 'activity' | null;
    id: string;
    title: string;
    subtitle: string | null;
    href: string;
  }>,
  calls: [] as unknown[],
}));

vi.mock('drizzle-orm', () => ({
  // The repo only uses `sql` as a tagged template — the mock returns a
  // placeholder; nothing inspects the value.
  sql: (..._args: unknown[]) => ({}),
}));

vi.mock('@/db/client', () => ({
  db: {
    execute: vi.fn(async (q: unknown) => {
      dbState.calls.push(q);
      return { rows: dbState.rows };
    }),
  },
}));

import { searchAll } from './repo';

beforeEach(() => {
  dbState.rows = [];
  dbState.calls = [];
});

describe('searchAll', () => {
  it('short-circuits empty input without touching the DB', async () => {
    const out = await searchAll('   ');
    expect(out).toEqual({ trips: [], segments: [], documents: [], wishlist: [] });
    expect(dbState.calls).toHaveLength(0);
  });

  it('dispatches rows into the correct group by `type`', async () => {
    dbState.rows = [
      {
        type: 'trip',
        segment_type: null,
        wishlist_type: null,
        id: 't1',
        title: 'Vietnam 2024',
        subtitle: null,
        href: '/trips/t1',
      },
      {
        type: 'segment',
        segment_type: 'flight',
        wishlist_type: null,
        id: 's1',
        title: 'HAN',
        subtitle: 'Vietnam 2024',
        href: '/trips/t1/flights',
      },
      {
        type: 'document',
        segment_type: null,
        wishlist_type: null,
        id: 'd1',
        title: 'boarding-pass.pdf',
        subtitle: 'Vietnam 2024',
        href: '/trips/t1/documents',
      },
      {
        type: 'wishlist',
        segment_type: null,
        wishlist_type: 'food',
        id: 'w1',
        title: 'Bún chả Hương Liên',
        subtitle: 'Vietnam · Hanoi',
        href: '/wishlist#w1',
      },
    ];

    const out = await searchAll('vietnam');

    expect(out.trips).toHaveLength(1);
    expect(out.segments).toHaveLength(1);
    expect(out.documents).toHaveLength(1);
    expect(out.wishlist).toHaveLength(1);
    expect(out.trips[0]?.id).toBe('t1');
    expect(out.trips[0]?.href).toBe('/trips/t1');
    expect(out.wishlist[0]?.wishlistType).toBe('food');
    expect(out.wishlist[0]?.href).toBe('/wishlist#w1');
  });

  it('preserves segmentType for the icon picker on the client', async () => {
    dbState.rows = [
      {
        type: 'segment',
        segment_type: 'hotel',
        wishlist_type: null,
        id: 's1',
        title: 'Hanoi Boutique',
        subtitle: 'Vietnam 2024',
        href: '/trips/t1/hotels',
      },
      {
        type: 'segment',
        segment_type: 'activity',
        wishlist_type: null,
        id: 's2',
        title: 'Old Quarter walk',
        subtitle: 'Vietnam 2024',
        href: '/trips/t1/activities',
      },
    ];

    const out = await searchAll('hanoi');

    expect(out.segments.map((r) => r.segmentType)).toEqual(['hotel', 'activity']);
  });

  it('returns empty groups when the DB returns no rows', async () => {
    const out = await searchAll('zzz-no-match');
    expect(out).toEqual({ trips: [], segments: [], documents: [], wishlist: [] });
  });
});
