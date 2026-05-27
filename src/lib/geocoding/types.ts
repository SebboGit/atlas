// Geocoding interface + result shape. One capability, behind one
// interface — implementations live next to this file (today only
// Nominatim; see ADR-0010). Feature code imports from `@/lib/geocoding`
// only, never from an implementation file.

/**
 * A successful geocode. Coordinates are decimal degrees in WGS84
 * (the same datum MapLibre + the segment country attribution use,
 * so a pin at `{lat, lng}` lines up with the rest of the map without
 * a projection step).
 */
export interface GeocodeResult {
  lat: number;
  lng: number;
  /**
   * Human-friendly canonical name from the geocoder
   * (e.g. "Hotel Example, Paris, France"). Surfaced as the
   * pin's tooltip label so users can confirm we resolved the right
   * place — a "couldn't find" result and "found the wrong place"
   * result look identical to the user without this.
   */
  displayName: string;
}

export interface Geocoder {
  /**
   * Resolve `query` to coordinates. Implementations MUST:
   *   - Never throw on transport/network/HTTP failure — return `null`.
   *   - Never throw on parsing failure — return `null`.
   *   - Never log the raw query string or response body. A short hash
   *     of the normalized query is fine for correlation.
   *   - Honour the provider's usage policy (rate limits, User-Agent).
   *
   * `null` means "no result", "couldn't be reached", or "provider
   * misbehaved". Callers should not distinguish: in every case the
   * pin can't be drawn, and the cache layer applies the negative-hit
   * TTL identically.
   */
  geocode(query: string): Promise<GeocodeResult | null>;
}

/**
 * Reverse lookup: coordinates → human-friendly place name. Used by the
 * Plus Code path so a decoded code carries an OSM `display_name` rather
 * than a synthesised label. Same no-throw / no-leak contract as
 * {@link Geocoder.geocode}. `null` covers every failure mode.
 */
export interface ReverseGeocoder {
  reverse(lat: number, lng: number): Promise<string | null>;
}
