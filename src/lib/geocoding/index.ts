// Public surface of the geocoding module. Feature code imports from
// here only — never from `./nominatim` or `./cache` directly. Keeps
// the provider choice swappable (per ADR-0010) and the cache contract
// the single source of truth.

export type {
  Geocoder,
  GeocodeResult,
  GeocodeCandidate,
  GeocodeSearcher,
  NamedGeocodeResult,
  OsmTag,
  ReverseGeocoder,
  StationQuery,
  StationSearcher,
  TagFilteredGeocoder,
  TagFilterOptions,
} from './types';

export { normalizeQuery } from './normalize';

export {
  getCachedOrFetch,
  getCachedMany,
  type CachedLookup,
  type GetCachedOrFetchResult,
} from './cache';

export { createNominatimGeocoder, NominatimGeocoder } from './nominatim';
export type { NominatimGeocoderOptions } from './nominatim';

export { createPhotonGeocoder, PhotonGeocoder } from './photon';
export type { PhotonGeocoderOptions } from './photon';

export { FallbackGeocoder, FallbackReverse } from './fallback';

export { chooseLocality } from './locality';

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

export {
  buildGeocodeQueries,
  buildGeocodeQuery,
  buildTransitEndpointQueries,
  type TransitEndpointQueries,
} from './segment-query';

export {
  encodeStationQuery,
  STATION_OSM_TAGS,
  stationNameMatches,
  stationRungs,
  stripStationName,
  tryParseStationQuery,
} from './station-query';

export { getPlaceCoordsMap, getPlaceCoordsView, type PlaceCoordsView } from './place-coords';

export { normalizeForGeocoder, rejoinSplitDiacritics } from './normalize-for-geocoder';

export { getGeocodeWorkerStatus, type GeocodeWorkerStatus } from './worker-health';

import { FallbackGeocoder, FallbackReverse } from './fallback';
import { createNominatimGeocoder } from './nominatim';
import { createPhotonGeocoder } from './photon';
import { PlaceResolver } from './place-resolver';
import type { Geocoder, GeocodeSearcher, StationSearcher } from './types';

/**
 * Lazy singleton geocoder. Returns a {@link PlaceResolver} so callers
 * automatically get Plus Code and station-key routing on top of the
 * free-text ladder: Photon first (venue-name matching), Nominatim on a
 * Photon null (structured-address backstop) — ADR-0018. Nominatim also
 * stays the reverse geocoder for Plus Code display names. Each provider
 * keeps its own throttle bucket; `search()` for the interactive picker
 * rides the same ladder. Tests inject their own implementation via
 * vi.mock.
 */
let instance: (Geocoder & GeocodeSearcher & StationSearcher) | null = null;

export function getGeocoder(): Geocoder & GeocodeSearcher & StationSearcher {
  if (!instance) {
    const nominatim = createNominatimGeocoder();
    const photon = createPhotonGeocoder();
    instance = new PlaceResolver({
      forward: new FallbackGeocoder(photon, nominatim),
      // Photon-first reverse too: its localized layer names the
      // metropolis ("Ho Chi Minh City") where raw OSM data can carry a
      // sub-city — the difference the card line exists to show.
      reverse: new FallbackReverse(photon, nominatim),
      // Station keys (ADR-0019): category-filtered Photon rungs, then the
      // raw name Nominatim-first. Photon has already been asked with
      // category filters (one to three rungs) by then, and its unfiltered
      // answer to "X Station" is the failure this path exists to avoid
      // (Tokyo Station → Ueno).
      stations: {
        tagged: photon,
        fallback: new FallbackGeocoder(nominatim, photon, 'station'),
      },
    });
  }
  return instance;
}
