import type { StyleSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';

import {
  ARC_ENDPOINTS_LAYER_ID,
  ARC_ENDPOINTS_SOURCE_ID,
  ARCS_SOURCE_ID,
  FLIGHT_ARC_LAYER_ID,
  TRANSIT_CASING_LAYER_ID,
  TRANSIT_LINE_LAYER_ID,
} from './arc-layers';
import {
  COUNTRIES_FILL_LAYER_ID,
  COUNTRIES_LINE_LAYER_ID,
  COUNTRIES_SOURCE_ID,
  type OverlayPalette,
  withOverlays,
} from './overlay-layers';

const dark: OverlayPalette = {
  primary: '#ff6b4a',
  countryFill: 'rgba(242, 243, 245, 0.05)',
  countryLine: 'rgba(242, 243, 245, 0.2)',
  casing: 'rgba(20, 20, 20, 0.9)',
  flightOpacity: 0.8,
};

// A two-label basemap: ground, water, then the labels.
function basemap(): StyleSpecification {
  return {
    version: 8,
    sprite: '/sprites/v4/black',
    sources: { protomaps: { type: 'vector', url: 'pmtiles:///api/tiles/world.pmtiles' } },
    layers: [
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water' },
      { id: 'roads_labels', type: 'symbol', source: 'protomaps', 'source-layer': 'roads' },
      { id: 'places', type: 'symbol', source: 'protomaps', 'source-layer': 'places' },
    ],
  };
}

const arcsData = { type: 'FeatureCollection' as const, features: [] };
const previous: StyleSpecification = {
  version: 8,
  sources: {
    protomaps: { type: 'vector', url: 'pmtiles:///api/tiles/world.pmtiles' },
    [COUNTRIES_SOURCE_ID]: { type: 'geojson', data: '/geo/world.geojson' },
    [ARCS_SOURCE_ID]: { type: 'geojson', data: arcsData },
    [ARC_ENDPOINTS_SOURCE_ID]: { type: 'geojson', data: arcsData },
  },
  layers: [],
};

describe('withOverlays', () => {
  it('carries the overlay sources across untouched', () => {
    const merged = withOverlays(basemap(), previous, dark);
    expect(merged.sources[ARCS_SOURCE_ID]).toBe(previous.sources[ARCS_SOURCE_ID]);
    expect(merged.sources[COUNTRIES_SOURCE_ID]).toBe(previous.sources[COUNTRIES_SOURCE_ID]);
    expect(merged.sources.protomaps).toEqual(basemap().sources.protomaps);
    expect(merged.sprite).toBe('/sprites/v4/black');
  });

  it('slides transit under the first label and stacks the rest on top', () => {
    const ids = withOverlays(basemap(), previous, dark).layers.map((layer) => layer.id);
    expect(ids).toEqual([
      'background',
      'water',
      TRANSIT_CASING_LAYER_ID,
      TRANSIT_LINE_LAYER_ID,
      'roads_labels',
      'places',
      COUNTRIES_FILL_LAYER_ID,
      COUNTRIES_LINE_LAYER_ID,
      FLIGHT_ARC_LAYER_ID,
      ARC_ENDPOINTS_LAYER_ID,
    ]);
  });

  it('paints the overlays from the palette it is given', () => {
    const layers = withOverlays(basemap(), previous, dark).layers;
    const paint = (id: string) =>
      (layers.find((layer) => layer.id === id) as { paint?: Record<string, unknown> }).paint;
    expect(paint(COUNTRIES_FILL_LAYER_ID)?.['fill-color']).toBe(dark.countryFill);
    expect(paint(COUNTRIES_LINE_LAYER_ID)?.['line-color']).toBe(dark.countryLine);
    expect(paint(TRANSIT_CASING_LAYER_ID)?.['line-color']).toBe(dark.casing);
    expect(paint(ARC_ENDPOINTS_LAYER_ID)?.['circle-stroke-color']).toBe(dark.casing);
    expect(paint(FLIGHT_ARC_LAYER_ID)?.['line-color']).toBe(dark.primary);
    expect(JSON.stringify(paint(FLIGHT_ARC_LAYER_ID)?.['line-opacity'])).toContain('0.8');
  });

  it('appends transit when the basemap has no labels', () => {
    const bare = { ...basemap(), layers: basemap().layers.slice(0, 2) };
    const ids = withOverlays(bare, previous, dark).layers.map((layer) => layer.id);
    expect(ids.slice(2, 4)).toEqual([TRANSIT_CASING_LAYER_ID, TRANSIT_LINE_LAYER_ID]);
  });
});
