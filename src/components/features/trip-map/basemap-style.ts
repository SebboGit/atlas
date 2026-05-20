// Protomaps "White" basemap style spec. See ADR-0011.
//
// Style construction is intentionally local — the @protomaps/basemaps
// `layers()` helper returns the per-zoom Protomaps layer set keyed
// against our `protomaps` source. The vector tiles themselves are
// served same-origin via /api/tiles/[...path] (the route handler);
// the `pmtiles://` scheme tells the pmtiles JS library to use byte-
// range fetches against the file behind that URL.
//
// Glyphs and sprite are served same-origin from public/basemaps-assets/.
// Source + update steps documented in that directory's README.md. No
// runtime CDN fetches.

import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';

const PROTOMAPS_SOURCE_ID = 'protomaps';

// Same-origin under Next.js's static `public/` directory. The `v4`
// segment matches the basemaps schema version that @protomaps/basemaps
// v5.x's `layers()` emits — keep in sync when bumping basemaps or
// updating the sprite directory.
//
// MapLibre accepts relative URLs for `glyphs` (the {fontstack}/{range}
// placeholders are resolved against the page origin internally) but
// REJECTS relative URLs for `sprite` — it needs a base it can append
// `.png`/`.json` to. We construct an absolute URL at style-build time
// from `window.location.origin`. SSR paths (server-side style build,
// which Atlas doesn't do today) fall back to a bare relative path
// and would surface the same MapLibre error there.
const GLYPHS_URL = '/basemaps-assets/fonts/{fontstack}/{range}.pbf';
const SPRITE_PATH = '/basemaps-assets/sprites/v4/light';

export interface BasemapStyleOptions {
  /**
   * Absolute or relative URL of the PMTiles file the browser fetches
   * tiles from. Defaults to `/api/tiles/world.pmtiles` — same-origin,
   * served by the tile-route handler at src/app/api/tiles/[...path]
   * out of TILES_DIR.
   */
  pmtilesUrl?: string;
  /**
   * BCP-47 language code for place labels. Defaults to `en` — same
   * convention the Nominatim geocoder uses on query
   * `accept-language` so the cache keys + map labels speak the same
   * language.
   */
  lang?: string;
}

/**
 * Build a MapLibre style spec wired to a self-hosted Protomaps
 * PMTiles source with the White theme applied. Theme choice rationale
 * lives in ADR-0011 §4 — White's warm-beige terrain matches Atlas's
 * paper aesthetic best.
 *
 * The returned style has only the basemap layers; callers add their
 * own sources / layers (country polygons, flight arcs, …) on top
 * after the map fires `load`.
 */
export function buildBasemapStyle(opts: BasemapStyleOptions = {}): StyleSpecification {
  const pmtilesUrl = opts.pmtilesUrl ?? '/api/tiles/world.pmtiles';
  const lang = opts.lang ?? 'en';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sprite: `${origin}${SPRITE_PATH}`,
    sources: {
      [PROTOMAPS_SOURCE_ID]: {
        type: 'vector',
        // The `pmtiles://` scheme is intercepted by the pmtiles JS
        // library's Protocol class (registered in trip-map.tsx on
        // module load). MapLibre never actually fetches `pmtiles://`
        // URLs itself — the protocol handler resolves them to
        // byte-range requests against the underlying URL.
        url: `pmtiles://${pmtilesUrl}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © OpenStreetMap',
      },
    },
    layers: layers(PROTOMAPS_SOURCE_ID, namedFlavor('white'), { lang }),
  };
}
