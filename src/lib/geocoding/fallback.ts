// Provider ladder for free-text geocoding (ADR-0018): Photon first
// (search-engine matching — the venue-name case), Nominatim second
// (stronger structured-address parsing — the backstop). One query
// string in, one result out, so the cache layer and PlaceResolver
// keep treating the ladder as a single opaque Geocoder and the
// cache-key contract is untouched.
//
// The secondary fires only on a primary null, which the DB cache makes
// rare and cheap: a miss costs one extra throttled request once per
// negative-TTL window, not per render. Either provider being down
// degrades to the other instead of to "no pins".

import { log } from '@/lib/log';

import type { Geocoder, GeocodeCandidate, GeocodeResult, GeocodeSearcher } from './types';

export class FallbackGeocoder implements Geocoder, GeocodeSearcher {
  constructor(
    private readonly primary: Geocoder & GeocodeSearcher,
    private readonly secondary: Geocoder & GeocodeSearcher,
  ) {}

  async geocode(query: string): Promise<GeocodeResult | null> {
    const first = await this.primary.geocode(query);
    if (first !== null) return first;
    const second = await this.secondary.geocode(query);
    // Providers log their own hit/miss with the hashed query; this
    // line only records that the ladder had to fall through, which is
    // the signal to watch if Photon's hit rate ever degrades.
    log.info({ recovered: second !== null }, 'geocoding.fallback.secondary_used');
    return second;
  }

  async search(query: string, opts?: { limit?: number }): Promise<GeocodeCandidate[]> {
    const first = await this.primary.search(query, opts);
    if (first.length > 0) return first;
    return this.secondary.search(query, opts);
  }
}
