import { describe, expect, it } from 'vitest';

import { wishlistItemCreateInput } from './validators';

const FOOD_BASE = {
  type: 'food' as const,
  data: { venue: 'Ramen Ichiraku' },
  countryCode: 'JP',
};

const ACTIVITY_BASE = {
  type: 'activity' as const,
  data: { title: 'Senso-ji Temple' },
  countryCode: 'JP',
};

describe('wishlistItemCreateInput — discriminator', () => {
  it('accepts a minimal food item', () => {
    const result = wishlistItemCreateInput.safeParse(FOOD_BASE);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe('food');
    if (result.data.type === 'food') {
      expect(result.data.data.venue).toBe('Ramen Ichiraku');
    }
  });

  it('accepts a minimal activity item', () => {
    const result = wishlistItemCreateInput.safeParse(ACTIVITY_BASE);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe('activity');
    if (result.data.type === 'activity') {
      expect(result.data.data.title).toBe('Senso-ji Temple');
    }
  });

  it('rejects unknown types', () => {
    const result = wishlistItemCreateInput.safeParse({
      ...FOOD_BASE,
      type: 'hotel',
    });
    expect(result.success).toBe(false);
  });

  it('rejects food data with an empty venue', () => {
    const result = wishlistItemCreateInput.safeParse({
      ...FOOD_BASE,
      data: { venue: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects activity data with an empty title', () => {
    const result = wishlistItemCreateInput.safeParse({
      ...ACTIVITY_BASE,
      data: { title: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields inside the food data branch', () => {
    const result = wishlistItemCreateInput.safeParse({
      ...FOOD_BASE,
      data: { venue: 'Narisawa', notAField: true },
    });
    expect(result.success).toBe(false);
  });
});

describe('wishlistItemCreateInput — country normalisation', () => {
  it('uppercases lowercase input', () => {
    const result = wishlistItemCreateInput.safeParse({ ...FOOD_BASE, countryCode: 'jp' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.countryCode).toBe('JP');
  });

  it('rejects an empty country', () => {
    const result = wishlistItemCreateInput.safeParse({ ...FOOD_BASE, countryCode: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-2-character country', () => {
    const result = wishlistItemCreateInput.safeParse({ ...FOOD_BASE, countryCode: 'JPN' });
    expect(result.success).toBe(false);
  });
});

describe('wishlistItemCreateInput — tags', () => {
  it('lowercases and de-duplicates tags', () => {
    const result = wishlistItemCreateInput.safeParse({
      ...FOOD_BASE,
      tags: ['Vegan', 'kid-friendly', 'vegan', 'KID-FRIENDLY'],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tags).toEqual(['vegan', 'kid-friendly']);
  });

  it('defaults tags to an empty array when omitted', () => {
    const result = wishlistItemCreateInput.safeParse(FOOD_BASE);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tags).toEqual([]);
  });

  it('rejects more than 20 tags', () => {
    const result = wishlistItemCreateInput.safeParse({
      ...FOOD_BASE,
      tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
    });
    expect(result.success).toBe(false);
  });
});
