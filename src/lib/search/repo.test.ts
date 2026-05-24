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
    type: 'trip' | 'segment' | 'document';
    segment_type: string | null;
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

import { buildPrefixTsquery, searchAll } from './repo';

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
        id: 't1',
        title: 'Vietnam 2024',
        subtitle: null,
        href: '/trips/t1',
      },
      {
        type: 'segment',
        segment_type: 'flight',
        id: 's1',
        title: 'HAN',
        subtitle: 'Vietnam 2024',
        href: '/trips/t1/flights',
      },
      {
        type: 'document',
        segment_type: null,
        id: 'd1',
        title: 'boarding-pass.pdf',
        subtitle: 'Vietnam 2024',
        href: '/trips/t1/documents',
      },
    ];

    const out = await searchAll('vietnam');

    expect(out.trips).toHaveLength(1);
    expect(out.segments).toHaveLength(1);
    expect(out.documents).toHaveLength(1);
    expect(out.trips[0]?.id).toBe('t1');
    expect(out.trips[0]?.href).toBe('/trips/t1');
  });

  it('preserves segmentType for the icon picker on the client', async () => {
    dbState.rows = [
      {
        type: 'segment',
        segment_type: 'hotel',
        id: 's1',
        title: 'Hanoi Boutique',
        subtitle: 'Vietnam 2024',
        href: '/trips/t1/hotels',
      },
      {
        type: 'segment',
        segment_type: 'activity',
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

describe('buildPrefixTsquery', () => {
  it('appends :* to every eligible token', () => {
    expect(buildPrefixTsquery('Pav Hot')).toBe('pav:* & hot:*');
  });

  it('lowercases tokens for visual consistency', () => {
    expect(buildPrefixTsquery('PAVILION')).toBe('pavilion:*');
  });

  it('drops single-character tokens to keep ranking meaningful', () => {
    // "p" alone would match too much; the user explicitly chose 2+
    // chars as the prefix-match threshold.
    expect(buildPrefixTsquery('p')).toBe('');
    expect(buildPrefixTsquery('P Pavilion')).toBe('pavilion:*');
  });

  it('returns empty string when no eligible tokens remain', () => {
    expect(buildPrefixTsquery('')).toBe('');
    expect(buildPrefixTsquery('   ')).toBe('');
    expect(buildPrefixTsquery('!@#$')).toBe('');
  });

  it('splits hyphenated input on the hyphen so the NOT operator never appears', () => {
    // The `simple` tsvector breaks "saint-jean" into two lexemes, so
    // querying for both prefixes matches what the user sees on the
    // page. A naïve `to_tsquery('saint-jean:*')` would parse the `-`
    // as a NOT operator.
    expect(buildPrefixTsquery('saint-jean')).toBe('saint:* & jean:*');
  });

  it('preserves Unicode letters for non-ASCII place names', () => {
    // Atlas stores "Tōkyō", "München", etc. verbatim; the prefix
    // builder must not strip diacritics or the partial-typing path
    // breaks for those names.
    expect(buildPrefixTsquery('Tōkyō')).toBe('tōkyō:*');
    expect(buildPrefixTsquery('München')).toBe('münchen:*');
  });

  it('normalises NFD-encoded input so IME and precomposed forms agree', () => {
    // Japanese / Korean IMEs can produce NFD-encoded output where
    // diacritics are separate combining codepoints. Without NFC
    // normalisation the \p{L} split would strip the combining marks
    // and produce a different tsquery for the same visible string.
    const nfc = 'Tōkyō';
    const nfd = 'Tōkyō';
    // Sanity: confirm the two string literals on disk are actually
    // different byte sequences. If a future formatter run normalises
    // them to the same form, this test would otherwise pass trivially.
    expect(nfd).not.toBe(nfc);
    expect(buildPrefixTsquery(nfd)).toBe(buildPrefixTsquery(nfc));
  });

  it('collapses any non-alphanumeric run into a token separator', () => {
    expect(buildPrefixTsquery('Damascus  Bukit, Bintang')).toBe('damascus:* & bukit:* & bintang:*');
  });
});
