// Rows for the trip-map legend. Pure so the "list only what's on the map"
// rules are tested without rendering the popover.

import type { TripMapArc, TripMapPinKind } from '@/lib/trip-map/repo';

// Legend order: flights first (they own the dashed arcs), then
// where-you-slept, then what-you-did.
const KIND_ORDER: readonly TripMapPinKind[] = ['flight', 'hotel', 'activity', 'transit', 'food'];

export const LABEL_BY_KIND: Readonly<Record<TripMapPinKind, string>> = {
  flight: 'Flight',
  hotel: 'Hotel',
  activity: 'Activity',
  transit: 'Transit',
  food: 'Food',
};

export type RouteStyle = 'dashed' | 'solid';

export interface LegendRow {
  kind: TripMapPinKind;
  label: string;
  /** Line swatch beside the pin, when that kind draws routes on this trip. */
  route: RouteStyle | null;
}

export function legendRows(
  kinds: ReadonlySet<TripMapPinKind>,
  routeKinds: ReadonlySet<TripMapArc['kind']>,
): LegendRow[] {
  return KIND_ORDER.filter((kind) => kinds.has(kind)).map((kind) => ({
    kind,
    label: LABEL_BY_KIND[kind],
    route:
      kind === 'flight' && routeKinds.has('flight')
        ? 'dashed'
        : kind === 'transit' && routeKinds.has('transit')
          ? 'solid'
          : null,
  }));
}
