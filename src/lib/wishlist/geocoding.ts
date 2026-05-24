// Bridge: wishlist-item lifecycle → background geocode. Mirrors the
// segment lifecycle bridge in src/lib/geocoding/lifecycle.ts.
//
// The whole reason wishlist and segment go through the same
// `buildGeocodeQuery` is to share `geocode_cache` rows: a wishlist
// item geocoded on save lands in the cache under the same key the
// materialised segment derives later. By the time the user opens the
// trip map, the new segment's pin is already there — no second
// Nominatim call.
//
// Fire-and-forget — no return path back to the wishlist row. The
// trip-map repo and any future wishlist-overlay repo read coords
// straight from the cache by the same query string.

import { enqueueGeocodeFetch } from '@/lib/geocoding';
import { buildGeocodeQuery } from '@/lib/geocoding/segment-query';

import type { WishlistItem } from './repo';

export interface GeocodeOnWishlistChangeArgs {
  item: WishlistItem;
  /**
   * Prior row on the update path. Omit on create. When provided AND
   * the derived geocode query matches the new one, the call is a
   * no-op so a tag-only or notes-only edit doesn't re-fire a fetch.
   */
  prior?: WishlistItem;
}

/**
 * Schedule a background geocode for a wishlist item that just
 * changed. Synchronous fire-and-forget; queue / provider failures
 * surface as log lines on the worker side.
 */
export function geocodeOnWishlistChange(args: GeocodeOnWishlistChangeArgs): void {
  const nextQuery = buildGeocodeQuery({
    type: args.item.type,
    data: args.item.data,
    locationName: args.item.locationName,
  });
  if (nextQuery === null || nextQuery.trim() === '') return;

  if (args.prior) {
    const priorQuery = buildGeocodeQuery({
      type: args.prior.type,
      data: args.prior.data,
      locationName: args.prior.locationName,
    });
    if (priorQuery === nextQuery) return;
  }

  enqueueGeocodeFetch(nextQuery);
}
