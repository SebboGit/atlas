// Verifies the wishlist → geocode bridge produces the SAME query
// string as the segment side for the same logical place. That shared
// key is what makes the materialised segment "born geocoded" — both
// look up the same `geocode_cache` row.

import { describe, expect, it, vi } from 'vitest';

import * as geocoding from '@/lib/geocoding';
import { buildGeocodeQuery } from '@/lib/geocoding/segment-query';

import { geocodeOnWishlistChange } from './geocoding';
import type { WishlistItem } from './repo';

function makeItem(overrides: Partial<WishlistItem>): WishlistItem {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    type: 'food',
    countryCode: 'JP',
    locationName: null,
    notes: null,
    tags: [],
    data: { venue: 'Ramen Ichiraku' },
    createdBy: '00000000-0000-0000-0000-000000000099',
    createdAt: new Date(),
    updatedAt: new Date(),
    searchText: null,
    searchTsv: null,
    ...overrides,
  } as WishlistItem;
}

describe('geocodeOnWishlistChange', () => {
  it('enqueues a fetch on create for a food item with a venue', () => {
    const spy = vi.spyOn(geocoding, 'enqueueGeocodeFetch').mockImplementation(() => {});
    geocodeOnWishlistChange({ item: makeItem({ data: { venue: 'Ramen Ichiraku' } }) });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain('Ramen Ichiraku');
    spy.mockRestore();
  });

  it('skips when no geocodable identity is present', () => {
    const spy = vi.spyOn(geocoding, 'enqueueGeocodeFetch').mockImplementation(() => {});
    // venue is empty string — pure malformed JSONB defence; in practice
    // the validator rejects this on write.
    geocodeOnWishlistChange({
      item: makeItem({ data: { venue: '' } } as Partial<WishlistItem>),
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('no-ops when the derived query is unchanged on update', () => {
    const spy = vi.spyOn(geocoding, 'enqueueGeocodeFetch').mockImplementation(() => {});
    const prior = makeItem({ data: { venue: 'Ichiraku' }, locationName: 'Ginza' });
    // tags / notes changed but the geocode query didn't.
    const next = makeItem({
      data: { venue: 'Ichiraku' },
      locationName: 'Ginza',
      tags: ['ramen'],
      notes: 'updated note',
    });
    geocodeOnWishlistChange({ item: next, prior });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('re-enqueues when the address changes on update', () => {
    const spy = vi.spyOn(geocoding, 'enqueueGeocodeFetch').mockImplementation(() => {});
    const prior = makeItem({ data: { venue: 'Ichiraku' } });
    const next = makeItem({ data: { venue: 'Ichiraku', address: '1-2-3 Ginza' } });
    geocodeOnWishlistChange({ item: next, prior });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('buildGeocodeQuery — wishlist/segment cache sharing', () => {
  it('produces the same query for a wishlist item and a segment with identical data', () => {
    const item = makeItem({
      data: { venue: 'Ramen Ichiraku', address: '1-2-3 Ginza' },
      locationName: 'Ginza',
    });
    const itemQuery = buildGeocodeQuery({
      type: item.type,
      data: item.data,
      locationName: item.locationName,
    });
    // Same shape as the materialised segment — verbatim data copy,
    // verbatim locationName, same type. Cache key must match.
    const segmentQuery = buildGeocodeQuery({
      type: 'food',
      data: item.data,
      locationName: item.locationName,
    });
    expect(itemQuery).toBe(segmentQuery);
    expect(itemQuery).not.toBeNull();
  });
});
