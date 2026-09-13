import { describe, expect, it } from 'vitest';

import type { TripMapArc } from '@/lib/trip-map/repo';

import {
  arcEndpointsToFeatureCollection,
  arcsToFeatureCollection,
  firstSymbolLayerId,
  flightArcLayer,
  presentRouteKinds,
  transitRouteLayers,
} from './arc-layers';

const flight: TripMapArc = {
  segmentId: 'f1',
  kind: 'flight',
  originLat: 51.47,
  originLng: -0.45,
  destLat: 35.55,
  destLng: 139.78,
  originCountry: 'GB',
  destCountry: 'JP',
};
const train: TripMapArc = {
  segmentId: 't1',
  kind: 'transit',
  mode: 'train',
  originLat: 35.68,
  originLng: 139.77,
  destLat: 34.99,
  destLng: 135.76,
  originCountry: 'JP',
  destCountry: 'JP',
};

describe('arcsToFeatureCollection', () => {
  it('keys features by index and carries kind and mode for the layer filters', () => {
    const fc = arcsToFeatureCollection([flight, train]);
    expect(fc.features.map((f) => f.id)).toEqual([0, 1]);
    expect(fc.features.map((f) => f.properties)).toEqual([
      { idx: 0, kind: 'flight', mode: '', originCountry: 'GB', destCountry: 'JP' },
      { idx: 1, kind: 'transit', mode: 'train', originCountry: 'JP', destCountry: 'JP' },
    ]);
  });
});

describe('arcEndpointsToFeatureCollection', () => {
  it('gives each arc two dots with ids idx*2 and idx*2+1', () => {
    const fc = arcEndpointsToFeatureCollection([flight, train]);
    expect(fc.features.map((f) => f.id)).toEqual([0, 1, 2, 3]);
    expect(fc.features[2]!.geometry).toEqual({ type: 'Point', coordinates: [139.77, 35.68] });
  });
});

describe('route layers', () => {
  it('keeps flights dashed and filtered to flight arcs', () => {
    const layer = flightArcLayer('#9b4a26');
    expect(layer.filter).toEqual(['==', ['get', 'kind'], 'flight']);
    expect(layer.paint?.['line-dasharray']).toEqual([2, 2]);
  });

  it('draws transit solid, cased, filtered, and dimmable', () => {
    const [casing, core] = transitRouteLayers('#9b4a26');
    for (const layer of [casing, core]) {
      expect(layer.filter).toEqual(['==', ['get', 'kind'], 'transit']);
      expect(layer.paint?.['line-dasharray']).toBeUndefined();
      expect(JSON.stringify(layer.paint?.['line-opacity'])).toContain('feature-state');
    }
    expect(core.paint?.['line-color']).toBe('#9b4a26');
    // Casing must be wider than the core at every stop to show as an edge.
    const stops = (layer: typeof casing) =>
      (layer.paint?.['line-width'] as unknown[]).slice(3).filter((_, i) => i % 2 === 1);
    stops(casing).forEach((w, i) => expect(w as number).toBeGreaterThan(stops(core)[i] as number));
  });
});

describe('firstSymbolLayerId', () => {
  it('finds the first label layer, or nothing', () => {
    expect(
      firstSymbolLayerId([
        { id: 'background', type: 'background' },
        { id: 'roads_rail', type: 'line' },
        { id: 'address_label', type: 'symbol' },
        { id: 'places_locality', type: 'symbol' },
      ]),
    ).toBe('address_label');
    expect(firstSymbolLayerId([{ id: 'water', type: 'fill' }])).toBeUndefined();
    expect(firstSymbolLayerId(undefined)).toBeUndefined();
  });
});

describe('presentRouteKinds', () => {
  it('collects the kinds on the trip', () => {
    expect([...presentRouteKinds([flight, train, flight])].sort()).toEqual(['flight', 'transit']);
    expect(presentRouteKinds([]).size).toBe(0);
  });
});
