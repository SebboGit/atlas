// Public surface of the geocoding module. Feature code imports from
// here only — never from `./nominatim` or `./cache` directly. Keeps
// the provider choice swappable (per ADR-0010) and the cache contract
// the single source of truth.

export type { Geocoder, GeocodeResult } from './types';

export { normalizeQuery } from './normalize';

export {
  getCachedOrFetch,
  getCachedMany,
  type CachedLookup,
  type GetCachedOrFetchResult,
} from './cache';

export { createNominatimGeocoder, NominatimGeocoder } from './nominatim';
export type { NominatimGeocoderOptions } from './nominatim';

export { enqueueGeocodeFetch, geocodeOnSegmentChange } from './lifecycle';
export type { GeocodeOnSegmentChangeArgs } from './lifecycle';

export { buildGeocodeQuery } from './segment-query';

export { normalizeForGeocoder } from './normalize-for-geocoder';

import { createNominatimGeocoder } from './nominatim';
import type { Geocoder } from './types';

/**
 * Lazy singleton geocoder. The lifecycle hook and any future caller
 * that needs to fire a fresh fetch should call this rather than
 * constructing their own — keeps a single throttle bucket per
 * process. Tests inject their own implementation via vi.mock.
 */
let instance: Geocoder | null = null;

export function getGeocoder(): Geocoder {
  if (!instance) instance = createNominatimGeocoder();
  return instance;
}
