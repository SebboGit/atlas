// Atlas's own layers on the trip map — the country texture, transit
// lines, flight arcs and their endpoint dots — and the palette they're
// painted in. One list serves both the first paint (added on `load`) and
// a theme switch (merged into the next basemap style by `withOverlays`),
// so the two can't drift apart.

import type {
  FillLayerSpecification,
  LayerSpecification,
  LineLayerSpecification,
  StyleSpecification,
} from 'maplibre-gl';

import {
  arcEndpointsLayer,
  firstSymbolLayerId,
  flightArcLayer,
  transitRouteLayers,
} from './arc-layers';

export const COUNTRIES_SOURCE_ID = 'countries';
export const COUNTRIES_FILL_LAYER_ID = 'country-fill';
export const COUNTRIES_LINE_LAYER_ID = 'country-line';

/**
 * Overlay colours for the current theme, read from the `--color-primary`
 * and `--map-*` tokens in globals.css. Canvas paint can't take `var()`,
 * so a theme switch re-reads them and repaints.
 */
export interface OverlayPalette {
  /** Coral — route lines and endpoint dots. */
  primary: string;
  /** Country texture fill — barely there; this map is about the pins. */
  countryFill: string;
  countryLine: string;
  /** Ground-coloured edge under transit lines and around endpoint dots. */
  casing: string;
  /** Resting opacity of the dashed flight course — higher on Black. */
  flightOpacity: number;
}

export interface OverlayLayers {
  /** Slid in under the basemap's first label layer, like a road (ADR-0019). */
  underLabels: LayerSpecification[];
  /** Stacked over the whole basemap, in this order. */
  onTop: LayerSpecification[];
}

// Country polygons — visual texture only, not data. They sit ABOVE the
// basemap layers and fade out as the user zooms in so the basemap's
// city / street detail can come through. At world zoom (the default)
// the polygons read as the headline texture; by Z6+ the basemap
// dominates.
function countryLayers(palette: OverlayPalette): [FillLayerSpecification, LineLayerSpecification] {
  return [
    {
      id: COUNTRIES_FILL_LAYER_ID,
      type: 'fill',
      source: COUNTRIES_SOURCE_ID,
      paint: {
        'fill-color': palette.countryFill,
        // Prominent at world view, gone by neighbourhood view.
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 2, 1, 6, 0],
      },
    },
    {
      id: COUNTRIES_LINE_LAYER_ID,
      type: 'line',
      source: COUNTRIES_SOURCE_ID,
      paint: {
        'line-color': palette.countryLine,
        'line-width': 0.5,
        // Lines linger a beat longer than the fill so country
        // boundaries remain identifiable at country / city zoom.
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.55, 7, 0],
      },
    },
  ];
}

/**
 * Every overlay layer, painted for `palette`. Transit lines go under the
 * labels; the rest stack on top — countries, then flights (a course
 * plotted over the chart, not part of it), then the endpoint dots.
 */
export function overlayLayers(palette: OverlayPalette): OverlayLayers {
  return {
    underLabels: transitRouteLayers(palette.primary, palette.casing),
    onTop: [
      ...countryLayers(palette),
      flightArcLayer(palette.primary, palette.flightOpacity),
      arcEndpointsLayer(palette.primary, palette.casing),
    ],
  };
}

/**
 * The `transformStyle` half of a theme switch: merge the overlays into a
 * freshly built basemap style. Sources the previous style carried and
 * the basemap doesn't (countries, arcs, endpoints) come across as they
 * are, data included, so MapLibre's style diff sees them unchanged and
 * keeps their data and feature-state (the dimming). The overlay layers
 * are rebuilt from `palette`, so for them the diff is a repaint.
 */
export function withOverlays(
  basemap: StyleSpecification,
  previous: StyleSpecification | undefined,
  palette: OverlayPalette,
): StyleSpecification {
  if (!previous) return basemap;

  const sources = { ...basemap.sources };
  for (const [id, source] of Object.entries(previous.sources)) {
    if (!(id in sources)) sources[id] = source;
  }

  const { underLabels, onTop } = overlayLayers(palette);
  const layers = [...basemap.layers];
  const labelsId = firstSymbolLayerId(layers);
  const labelsAt = labelsId ? layers.findIndex((layer) => layer.id === labelsId) : layers.length;
  layers.splice(labelsAt, 0, ...underLabels);
  layers.push(...onTop);

  return { ...basemap, sources, layers };
}
