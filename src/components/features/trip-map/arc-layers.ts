// Route sources and layer specs for the trip map — flight arcs and
// transit lines (ADR-0019). Pure data builders, split out of trip-map.tsx
// so the layer contract (ids, filters, the dim feature-state) is tested
// without a live MapLibre instance.

import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LineLayerSpecification,
} from 'maplibre-gl';

import type { TripMapArc } from '@/lib/trip-map/repo';

import { curvedArcCoords } from './arc-geometry';

export const ARCS_SOURCE_ID = 'trip-arcs';
export const FLIGHT_ARC_LAYER_ID = 'trip-arcs-lines';
export const TRANSIT_CASING_LAYER_ID = 'trip-transit-casing';
export const TRANSIT_LINE_LAYER_ID = 'trip-transit-line';
// Endpoint dots sit on their own source, one small terracotta mark per
// route end so a leg reads as a plotted course (origin → line →
// destination), not an anonymous hairline.
export const ARC_ENDPOINTS_SOURCE_ID = 'trip-arc-endpoints';
export const ARC_ENDPOINTS_LAYER_ID = 'trip-arc-endpoints-dots';

const IVORY = 'rgba(255, 253, 248, 0.9)';
// Opacity that drops to `dimmed` while the dim effect has set the
// feature's `dimmed` state (country filter or timeline highlight).
function dimmable(dimmed: number, normal: number): ExpressionSpecification {
  return ['case', ['boolean', ['feature-state', 'dimmed'], false], dimmed, normal];
}

export function arcsToFeatureCollection(arcs: readonly TripMapArc[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: arcs.map((arc, idx) => ({
      type: 'Feature',
      // The feature id is the array index — the dim effect sets
      // feature-state by it.
      id: idx,
      geometry: {
        type: 'MultiLineString',
        coordinates: curvedArcCoords(arc),
      },
      properties: {
        idx,
        kind: arc.kind,
        mode: arc.mode ?? '',
        originCountry: arc.originCountry ?? '',
        destCountry: arc.destCountry ?? '',
      },
    })),
  };
}

// One point feature per route end. Ids idx*2 / idx*2+1 so a dot dims in
// lockstep with its line via the same arc idx. Deduping isn't worth it —
// a shared airport or station just stacks two coincident dots.
export function arcEndpointsToFeatureCollection(
  arcs: readonly TripMapArc[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: arcs.flatMap((arc, idx) => [
      {
        type: 'Feature' as const,
        id: idx * 2,
        geometry: { type: 'Point' as const, coordinates: [arc.originLng, arc.originLat] },
        properties: { idx, kind: arc.kind },
      },
      {
        type: 'Feature' as const,
        id: idx * 2 + 1,
        geometry: { type: 'Point' as const, coordinates: [arc.destLng, arc.destLat] },
        properties: { idx, kind: arc.kind },
      },
    ]),
  };
}

export function flightArcLayer(primary: string): LineLayerSpecification {
  return {
    id: FLIGHT_ARC_LAYER_ID,
    type: 'line',
    source: ARCS_SOURCE_ID,
    filter: ['==', ['get', 'kind'], 'flight'],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': primary,
      'line-width': 1.5,
      // Stitched, not solid — a dashed thread reads as a plotted course
      // on a logbook chart, the one geometry unique to a travel map.
      // [2,2] = dash length 2, gap 2 (× line-width), the tightest stitch
      // that still resolves as dashes at our widths. `line-cap: butt`
      // keeps each dash a clean tick; `round` would bleed the gaps shut.
      'line-dasharray': [2, 2],
      // Dimmed = arc isn't fully within the active country (when a chip
      // is active). Otherwise a soft default so arcs read as connective
      // tissue, not the headline.
      'line-opacity': dimmable(0.12, 0.55),
    },
  };
}

/**
 * The transit line: an ivory casing under a solid terracotta core. Solid
 * so it can't be read as a flight's dashed course or the basemap's
 * dashed railway; terracotta rather than ink so it doesn't read as a
 * country border. Returned casing-first — add them in this order.
 */
export function transitRouteLayers(
  primary: string,
): [LineLayerSpecification, LineLayerSpecification] {
  const filter: LineLayerSpecification['filter'] = ['==', ['get', 'kind'], 'transit'];
  const layout: LineLayerSpecification['layout'] = { 'line-cap': 'round', 'line-join': 'round' };
  return [
    {
      id: TRANSIT_CASING_LAYER_ID,
      type: 'line',
      source: ARCS_SOURCE_ID,
      filter,
      layout,
      paint: {
        'line-color': IVORY,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.5, 8, 4, 12, 6],
        'line-opacity': dimmable(0.1, 0.85),
      },
    },
    {
      id: TRANSIT_LINE_LAYER_ID,
      type: 'line',
      source: ARCS_SOURCE_ID,
      filter,
      layout,
      paint: {
        'line-color': primary,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.25, 8, 2, 12, 3],
        'line-opacity': dimmable(0.15, 0.85),
      },
    },
  ];
}

export function arcEndpointsLayer(primary: string): CircleLayerSpecification {
  return {
    id: ARC_ENDPOINTS_LAYER_ID,
    type: 'circle',
    source: ARC_ENDPOINTS_SOURCE_ID,
    paint: {
      'circle-radius': 2.6,
      'circle-color': primary,
      // A hairline ivory ring lifts the dot off a dark coastline or the
      // line crossing under it.
      'circle-stroke-width': 1,
      'circle-stroke-color': IVORY,
      'circle-opacity': dimmable(0.15, 0.9),
      'circle-stroke-opacity': dimmable(0.15, 0.9),
    },
  };
}

/**
 * The first basemap label layer, so transit lines can slide in under the
 * place names like any road. Undefined when the style has none — the
 * lines then simply go on top.
 */
export function firstSymbolLayerId(
  layers: ReadonlyArray<{ id: string; type: string }> | undefined,
): string | undefined {
  return layers?.find((layer) => layer.type === 'symbol')?.id;
}

/** Route kinds present on the trip — drives the legend's line swatches. */
export function presentRouteKinds(arcs: readonly TripMapArc[]): ReadonlySet<TripMapArc['kind']> {
  return new Set(arcs.map((arc) => arc.kind));
}
