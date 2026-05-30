// Place resolver: forward-geocode dispatcher that recognises Plus Code
// inputs and routes them to an offline-decode (full code) or anchored
// recoverNearest (local code) pipeline before falling back to free-text
// Nominatim search.
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
import type {
  Geocoder,
  GeocodeCandidate,
  GeocodeResult,
  GeocodeSearcher,
  ReverseGeocoder,
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
}

export class PlaceResolver implements Geocoder, GeocodeSearcher {
  constructor(private readonly deps: PlaceResolverDeps) {}

  async geocode(query: string): Promise<GeocodeResult | null> {
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
    // display name. A null here doesn't sink the result — we keep the
    // coords (they're correct) and synthesise a label so the cache row
    // parses to a usable GeocodeResult.
    const displayName = await this.deps.reverse.reverse(coords.lat, coords.lng);

    return {
      lat: coords.lat,
      lng: coords.lng,
      displayName: displayName ?? `Plus Code ${fullCode}`,
    };
  }
}
