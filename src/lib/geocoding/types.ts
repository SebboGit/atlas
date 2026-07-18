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
  /**
   * Which provider produced the result ("photon", "nominatim", …).
   * Diagnostic only — persisted to `geocode_cache.source` so hit-rate
   * questions ("is the fallback carrying the load?") are answerable
   * from the table. Optional: implementations that predate the ladder
   * omit it and the cache records their historical default.
   */
  source?: string;
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
 * A single candidate from a multi-result search. Richer than
 * {@link GeocodeResult} because the interactive address picker needs to
 * show the user enough to disambiguate three near-identical hits — the
 * place name on its own line, the full address underneath, and an
 * OSM-type chip ("restaurant", "hotel") for a glanceable category.
 *
 * Kept separate from `GeocodeResult` on purpose: the render path
 * (`Geocoder.geocode`) only ever needs `{ lat, lng, displayName }`, and
 * bloating that shape would push the extra fields through the cache and
 * the trip-map repo where they're dead weight. This shape exists solely
 * for the button-triggered picker.
 */
export interface GeocodeCandidate {
  lat: number;
  lng: number;
  /** OSM `display_name` — the full canonical address string. */
  displayName: string;
  /**
   * Short place name (e.g. "Park Hyatt Tokyo"). From Nominatim
   * `namedetails.name` when present, else the first comma-part of
   * `display_name`. Drives the picker's primary line.
   */
  name: string;
  /**
   * The address line shown beneath the name. Today this is the full
   * `display_name`; kept as its own field so the picker's secondary
   * line has a stable contract independent of the primary name source.
   */
  addressLabel: string;
  /**
   * Coarse OSM feature type — Nominatim's `type` (e.g. "restaurant",
   * "hotel", "attraction"). Surfaced as a chip. `null` when the hit
   * carries no recognisable type.
   */
  osmType: string | null;
  /**
   * Nominatim's `class` / `category` (e.g. "amenity", "tourism").
   * Carried alongside `osmType` for callers that want a coarser bucket;
   * `null` when absent.
   */
  category: string | null;
  /**
   * ISO 3166-1 alpha-2, uppercased, from `address.country_code`. Used
   * to autofill an empty country dropdown on pick. `null` when the hit
   * carries no country code.
   */
  countryCode: string | null;
}

/**
 * Multi-candidate forward search. Distinct from {@link Geocoder.geocode}
 * (which returns the single best hit for the render path): this returns
 * up to `limit` candidates for the interactive picker. Same no-throw /
 * no-leak contract — any failure mode returns `[]`, never throws, and
 * the raw query / response body are never logged.
 */
export interface GeocodeSearcher {
  search(query: string, opts?: { limit?: number }): Promise<GeocodeCandidate[]>;
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
