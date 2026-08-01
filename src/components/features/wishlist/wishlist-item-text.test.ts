import { describe, expect, it } from 'vitest';

import type { WishlistItem } from '@/lib/wishlist';

import {
  wishlistAddress,
  wishlistItemName,
  wishlistPlusCode,
  wishlistSubtitle,
} from './wishlist-item-text';

// No `as WishlistItem` cast: the literal supplies every field, so a new
// required member on the row type fails typecheck here rather than being
// silently suppressed.
function item(over: Partial<WishlistItem>): WishlistItem {
  // Annotated, not cast — dropping the old `as WishlistItem` immediately
  // surfaced the two generated search columns this fixture never set.
  const base: WishlistItem = {
    id: 'wl-1',
    type: 'food',
    countryCode: 'JP',
    locationName: null,
    notes: null,
    tags: [],
    data: { venue: 'Den' },
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    searchText: null,
    searchTsv: null,
  };
  // Object.assign rather than a spread literal: spreading a Partial<T>
  // widens every overridden field to `| undefined`, which no longer
  // satisfies T.
  return Object.assign(base, over);
}

describe('wishlistItemName', () => {
  it('reads the venue for food and the title for an activity', () => {
    expect(wishlistItemName(item({ data: { venue: 'Den' } }))).toBe('Den');
    expect(wishlistItemName(item({ type: 'activity', data: { title: 'Senso-ji' } }))).toBe(
      'Senso-ji',
    );
  });

  it('falls back to a generic noun on malformed data', () => {
    expect(wishlistItemName(item({ data: { nonsense: true } }))).toBe('Food spot');
    expect(wishlistItemName(item({ type: 'activity', data: { nonsense: true } }))).toBe(
      'Attraction',
    );
  });
});

describe('wishlistAddress', () => {
  it('reads the address for both types', () => {
    expect(wishlistAddress(item({ data: { venue: 'Den', address: 'Jingūmae 1-2' } }))).toBe(
      'Jingūmae 1-2',
    );
    expect(
      wishlistAddress(
        item({ type: 'activity', data: { title: 'Senso-ji', address: 'Asakusa 2-3' } }),
      ),
    ).toBe('Asakusa 2-3');
  });

  it('is undefined when absent, blank, or the data is malformed', () => {
    expect(wishlistAddress(item({ data: { venue: 'Den' } }))).toBeUndefined();
    expect(wishlistAddress(item({ data: { nonsense: true } }))).toBeUndefined();
  });
});

describe('wishlistPlusCode', () => {
  it('reads the stored code for both types', () => {
    expect(wishlistPlusCode(item({ data: { venue: 'Den', plusCode: '8Q7XMPWG+5V' } }))).toBe(
      '8Q7XMPWG+5V',
    );
    expect(wishlistPlusCode(item({ data: { venue: 'Den' } }))).toBeUndefined();
  });
});

describe('wishlistSubtitle', () => {
  it('shows a food address', () => {
    expect(
      wishlistSubtitle(item({ data: { venue: 'Sushi Saito', address: 'Akasaka, Minato City' } })),
    ).toBe('Akasaka, Minato City');
  });

  it('shows an activity description, preferring it over the address', () => {
    expect(
      wishlistSubtitle(
        item({
          type: 'activity',
          data: {
            title: 'Ghibli Museum',
            description: 'Buy on release',
            address: '1-1 Shimorenjaku',
          },
        }),
      ),
    ).toBe('Buy on release');
  });

  it('falls back to an activity address when there is no description', () => {
    // activityDataSchema has carried `address` since Plus Codes landed;
    // the card used to drop it on the floor.
    expect(
      wishlistSubtitle(
        item({ type: 'activity', data: { title: 'Ghibli Museum', address: '1-1 Shimorenjaku' } }),
      ),
    ).toBe('1-1 Shimorenjaku');
  });

  it('does not fall back to locationName — the meta row already prints it', () => {
    expect(wishlistSubtitle(item({ locationName: 'Jingūmae' }))).toBeUndefined();
    expect(
      wishlistSubtitle(
        item({ type: 'activity', data: { title: 'Senso-ji' }, locationName: 'Asakusa' }),
      ),
    ).toBeUndefined();
  });

  it('returns undefined for malformed data rather than throwing', () => {
    expect(wishlistSubtitle(item({ data: { nonsense: true } }))).toBeUndefined();
    expect(wishlistSubtitle(item({ type: 'activity', data: { nonsense: true } }))).toBeUndefined();
  });
});
