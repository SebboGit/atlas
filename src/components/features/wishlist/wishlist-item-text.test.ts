import { describe, expect, it } from 'vitest';

import type { WishlistItem } from '@/lib/wishlist';

import { wishlistItemName, wishlistPlusCode, wishlistSubtitle } from './wishlist-item-text';

function item(over: Partial<WishlistItem>): WishlistItem {
  return {
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
    ...over,
  } as WishlistItem;
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
