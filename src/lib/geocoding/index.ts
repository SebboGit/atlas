// Public surface of the geocoding module. Feature code imports from
// here only — never from `./nominatim` or `./cache` directly. Keeps
// the provider choice swappable (per ADR-0010) and the cache contract
// the single source of truth.

export type { Geocoder, GeocodeResult, ReverseGeocoder } from './types';

export { normalizeQuery } from './normalize';

export {
  getCachedOrFetch,
  getCachedMany,
  type CachedLookup,
  type GetCachedOrFetchResult,
} from './cache';

export { createNominatimGeocoder, NominatimGeocoder } from './nominatim';
export type { NominatimGeocoderOptions } from './nominatim';

export { PlaceResolver } from './place-resolver';
export type { PlaceResolverDeps } from './place-resolver';

export {
  decodePlusCode,
  encodePlusCode,
  isValidPlusCodeShape,
  recoverPlusCode,
  tryParsePlusCode,
  type ParsedPlusCode,
} from './plus-code';

export { enqueueGeocodeFetch, geocodeOnSegmentChange } from './lifecycle';
export type { GeocodeOnSegmentChangeArgs } from './lifecycle';

export { buildGeocodeQuery } from './segment-query';

export { getPlaceCoordsMap, getPlaceCoordsView, type PlaceCoordsView } from './place-coords';

export { normalizeForGeocoder } from './normalize-for-geocoder';

import { createNominatimGeocoder } from './nominatim';
import { PlaceResolver } from './place-resolver';
import type { Geocoder } from './types';

/**
 * Lazy singleton geocoder. Returns a {@link PlaceResolver} so callers
 * automatically get Plus Code routing on top of free-text Nominatim
 * search. Keeps a single throttle bucket per process (the underlying
 * `NominatimGeocoder` is shared as both forward and reverse). Tests
 * inject their own implementation via vi.mock.
 */
let instance: Geocoder | null = null;

export function getGeocoder(): Geocoder {
  if (!instance) {
    const nominatim = createNominatimGeocoder();
    instance = new PlaceResolver({ forward: nominatim, reverse: nominatim });
  }
  return instance;
}
