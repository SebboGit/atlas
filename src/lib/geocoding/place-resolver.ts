// Place resolver: forward-geocode dispatcher that recognises structured
// query keys before falling back to free-text search:
//
//   - station keys (`station:train:jp:Kyoto Station`, ADR-0019) run a
//     category-filtered Photon ladder with a name guard, then the raw
//     name through the free-text ladder;
//   - Plus Codes route to an offline-decode (full code) or anchored
//     recoverNearest (local code) pipeline;
//   - everything else is free text.
//
// The resolver is itself a `Geocoder`, so the cache layer and the
// lifecycle hook keep treating it as one opaque dependency. The Plus
// Code path always reverse-geocodes for `displayName` so cache rows
// carry an OSM-canonical label rather than a synthesised "Plus Code X"
// string; if the reverse call fails we synthesise that label as a
// last-resort fallback so the row still parses to a usable result.

import { log } from '@/lib/log';

import {
  decodePlusCode,
  recoverPlusCode,
  tryParsePlusCode,
  type ParsedPlusCode,
} from './plus-code';
import {
  STATION_OSM_TAGS,
  stationNameMatches,
  stationRungs,
  tryParseStationQuery,
} from './station-query';
import type {
  Geocoder,
  GeocodeCandidate,
  GeocodeResult,
  GeocodeSearcher,
  ReverseGeocoder,
  StationQuery,
  StationSearcher,
  TagFilteredGeocoder,
} from './types';

/**
 * Anything that can do both forward and reverse Nominatim-style
 * lookups. In production `NominatimGeocoder` implements both; tests
 * pass slim fakes. `forward` optionally also implements
 * {@link GeocodeSearcher} — when it does, the resolver surfaces
 * `search()` straight through (the picker never wants Plus Code routing
 * on a multi-candidate name search).
 */
export interface PlaceResolverDeps {
  forward: Geocoder & Partial<GeocodeSearcher>;
  reverse: ReverseGeocoder;
  /**
   * Station-aware transit endpoints (ADR-0019). `tagged` runs the
   * category-filtered lookups; `fallback` receives the RAW station name
   * when every tagged rung misses. Without this dep a station key is
   * resolved as its raw name through `forward` — no worse than before.
   */
  stations?: {
    tagged: TagFilteredGeocoder;
    fallback: Geocoder;
  };
}

// Tagged hits per rung. A few rather than one: the name guard skips a
// wrong top hit and takes the next one that agrees.
const STATION_RUNG_LIMIT = 3;

export class PlaceResolver implements Geocoder, GeocodeSearcher, StationSearcher {
  constructor(private readonly deps: PlaceResolverDeps) {}

  async geocode(query: string): Promise<GeocodeResult | null> {
    const station = tryParseStationQuery(query);
    if (station !== null) return this.resolveStation(station);

    const parsed = tryParsePlusCode(query);
    if (parsed === null) {
      // Not a Plus Code — fall through to free-text search. This is
      // the hot path for hotel addresses, activity names, etc.
      return this.deps.forward.geocode(query);
    }
    return this.resolvePlusCode(parsed);
  }

  /**
   * Multi-candidate search for the interactive picker. Deliberately
   * does NOT route through the Plus Code pipeline: the picker always
   * sends a venue/POI name, never a code, and wants the raw candidate
   * list. Delegates to the forward dependency's `search` when present;
   * a forward that can't search yields `[]` (graceful degradation, same
   * as any miss).
   */
  async search(query: string, opts?: { limit?: number }): Promise<GeocodeCandidate[]> {
    if (typeof this.deps.forward.search !== 'function') return [];
    return this.deps.forward.search(query, opts);
  }

  /**
   * Station candidates for the picker: the tagged rungs only, name-
   * guarded, first rung with any agreeing candidate wins. `[]` sends the
   * picker on to its ordinary name / address rungs.
   */
  async searchStation(q: StationQuery, opts?: { limit?: number }): Promise<GeocodeCandidate[]> {
    const tagged = this.deps.stations?.tagged;
    if (!tagged) return [];
    for (const rung of stationRungs(q)) {
      const candidates = await tagged.searchWithTags(rung.query, {
        tags: STATION_OSM_TAGS[q.mode],
        countryCode: rung.countryCode,
        limit: opts?.limit ?? STATION_RUNG_LIMIT,
      });
      const agreeing = candidates.filter((c) => stationNameMatches(q.name, c.name));
      if (agreeing.length > 0) return agreeing;
    }
    return [];
  }

  private async resolveStation(q: StationQuery): Promise<GeocodeResult | null> {
    const stations = this.deps.stations;
    if (!stations) return this.deps.forward.geocode(q.name);

    for (const rung of stationRungs(q)) {
      const hits = await stations.tagged.geocodeWithTags(rung.query, {
        tags: STATION_OSM_TAGS[q.mode],
        countryCode: rung.countryCode,
        limit: STATION_RUNG_LIMIT,
      });
      const hit = hits.find((h) => stationNameMatches(q.name, h.name));
      if (hit) {
        const { name: _name, ...result } = hit;
        return { ...result, source: 'photon-station' };
      }
    }

    // Every tagged rung missed or disagreed: the raw name through the
    // free-text ladder — exactly the query transit sent before ADR-0019.
    // Never the stripped name, which on its own is a city.
    log.info({ mode: q.mode }, 'geocoding.place_resolver.station_fallback');
    return stations.fallback.geocode(q.name);
  }

  private async resolvePlusCode(parsed: ParsedPlusCode): Promise<GeocodeResult | null> {
    let fullCode: string | null;

    if (parsed.kind === 'full') {
      fullCode = parsed.code;
    } else {
      // Local code: forward-geocode the anchor text to a reference
      // point, then lift the local code to a full code from that
      // anchor. A null anchor here would mean the schema accepted a
      // bare local code, which it shouldn't — defence in depth.
      if (parsed.reference === null) {
        log.warn(
          { kind: 'local', codeLen: parsed.code.length },
          'geocoding.place_resolver.local_without_anchor',
        );
        return null;
      }
      const anchor = await this.deps.forward.geocode(parsed.reference);
      if (anchor === null) {
        // Anchor didn't resolve — we can't lift the local code without
        // a reference point. Same outcome as a Nominatim null: caller
        // applies the negative-hit TTL and the pin is hidden.
        log.info({ kind: 'local' }, 'geocoding.place_resolver.anchor_unresolved');
        return null;
      }
      fullCode = recoverPlusCode(parsed.code, anchor.lat, anchor.lng);
    }

    if (fullCode === null) {
      log.warn({ kind: parsed.kind }, 'geocoding.place_resolver.recover_failed');
      return null;
    }

    const coords = decodePlusCode(fullCode);
    if (coords === null) {
      log.warn({ kind: parsed.kind }, 'geocoding.place_resolver.decode_failed');
      return null;
    }

    // Reverse-geocode at the decoded coords for an OSM-canonical
    // display name (and a city for the card line, #111). A null here
    // doesn't sink the result — we keep the coords (they're correct)
    // and synthesise a label so the cache row parses to a usable
    // GeocodeResult.
    const reversed = await this.deps.reverse.reverse(coords.lat, coords.lng);

    return {
      lat: coords.lat,
      lng: coords.lng,
      displayName: reversed?.displayName ?? `Plus Code ${fullCode}`,
      city: reversed?.city ?? null,
      // Provenance for geocode_cache.source (ADR-0018): these rows
      // came from offline decode, not from either free-text provider.
      source: 'plus-code',
    };
  }
}
