// What the camera does when the timeline focuses a segment. Pure, so
// the per-kind rules are tested without MapLibre; trip-map.tsx executes
// the returned target.

import type { TripMapArc, TripMapPin } from '@/lib/trip-map/repo';

export interface FramePoint {
  lat: number;
  lng: number;
}

// Max zoom when fitting a route to its two ends. A flight spans countries,
// so city scale is plenty; a train leg spans a region, and a short hop
// between neighbouring stations should frame at neighbourhood scale (the
// same Z12 a pin click flies to).
export const ARC_FOCUS_MAX_ZOOM: Readonly<Record<TripMapArc['kind'], number>> = {
  flight: 8,
  transit: 12,
};

export type FocusTarget =
  | { type: 'fit'; points: FramePoint[]; maxZoom: number; tooltipPin: TripMapPin | null }
  | { type: 'fly'; pin: TripMapPin; showTooltip: boolean }
  | { type: 'none' };

/**
 * Resolve a focused segment to a camera move:
 *   - a route (flight or transit) fits both ends. A flight shows no
 *     tooltip — its IATA labels are always on — while transit names its
 *     arrival station;
 *   - a transit leg with two pins but no line (too far apart to draw)
 *     still fits both;
 *   - a single pin flies to it, with a tooltip unless it's a flight;
 *   - anything else leaves the camera alone.
 */
export function resolveFocusTarget(
  focusId: string,
  pins: readonly TripMapPin[],
  arcs: readonly TripMapArc[],
): FocusTarget {
  const own = pins.filter((pin) => pin.segmentId === focusId);
  const arrival = own.find((pin) => pin.endpoint === 'destination') ?? null;

  // The arc goes first: a flight's origin pin shares its segment id, and
  // checking the pin first would zoom to the origin airport instead of
  // framing the route.
  const arc = arcs.find((a) => a.segmentId === focusId);
  if (arc) {
    return {
      type: 'fit',
      points: [
        { lat: arc.originLat, lng: arc.originLng },
        { lat: arc.destLat, lng: arc.destLng },
      ],
      maxZoom: ARC_FOCUS_MAX_ZOOM[arc.kind],
      tooltipPin: arc.kind === 'transit' ? arrival : null,
    };
  }

  if (own.length >= 2) {
    return {
      type: 'fit',
      points: own.map((pin) => ({ lat: pin.lat, lng: pin.lng })),
      maxZoom: ARC_FOCUS_MAX_ZOOM.transit,
      tooltipPin: arrival,
    };
  }

  const pin = own[0];
  if (pin) return { type: 'fly', pin, showTooltip: pin.kind !== 'flight' };
  return { type: 'none' };
}
