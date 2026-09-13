// Station-to-station routes for train / bus / ferry segments on the trip
// map (ADR-0019). Pure: given what the geocode cache knows about each
// end, decide whether a line is drawn and which single "Not pinned"
// reason (if any) the segment carries. The repo does the I/O.

import type { TransitEndpointMode } from '@/lib/segments';

/** What the cache knows about one end of a leg. */
export type EndpointLookup =
  | { state: 'none' } // no name, address or Plus Code for this end
  | { state: 'null' } // the geocoder ran and found nothing
  | { state: 'miss' } // no cache row yet
  | { state: 'hit'; lat: number; lng: number };

export const PENDING_REASON = 'Geocoding pending — try again in a moment.';
export const NOT_FOUND_REASON = "We couldn't find this place on the map.";
export const DEPARTURE_NOT_FOUND_REASON = "We couldn't find the departure point on the map.";
export const ARRIVAL_NOT_FOUND_REASON = "We couldn't find the arrival point on the map.";

// Great-circle sanity caps per mode. A pair further apart than any real
// leg of that mode is a wrong-continent match ("Central Station"), so the
// line is withheld while both pins stay visible. Initial values — tuning
// them doesn't need a new ADR. Train covers the Trans-Siberian.
export const MAX_ROUTE_KM: Readonly<Record<TransitEndpointMode, number>> = {
  train: 7000,
  bus: 5000,
  ferry: 3000,
};

// Below this the two ends are the same place; a line would be a dot.
export const MIN_ROUTE_KM = 0.05;

const EARTH_RADIUS_KM = 6371;

export function greatCircleKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface TransitRouteDecision {
  drawRoute: boolean;
  /** The one "Not pinned" reason for the segment, or null for none. */
  reason: string | null;
}

/**
 * Decide the line and the Not-pinned reason for one leg. Checked in
 * order: a pending end outranks everything (a refresh may still change
 * the picture); two resolved ends draw a line unless they're implausibly
 * far apart or the same spot; otherwise the reason names the end that
 * couldn't be found. A leg with only one end named gets no entry — its
 * one pin shows, the same as a flight with no origin airport.
 */
export function resolveTransitRoute(
  mode: TransitEndpointMode,
  origin: EndpointLookup,
  destination: EndpointLookup,
): TransitRouteDecision {
  if (origin.state === 'miss' || destination.state === 'miss') {
    return { drawRoute: false, reason: PENDING_REASON };
  }
  if (origin.state === 'hit' && destination.state === 'hit') {
    const km = greatCircleKm(origin, destination);
    return { drawRoute: km >= MIN_ROUTE_KM && km <= MAX_ROUTE_KM[mode], reason: null };
  }
  if (origin.state === 'null' && destination.state === 'hit') {
    return { drawRoute: false, reason: DEPARTURE_NOT_FOUND_REASON };
  }
  if (destination.state === 'null' && origin.state === 'hit') {
    return { drawRoute: false, reason: ARRIVAL_NOT_FOUND_REASON };
  }
  if (origin.state === 'null' || destination.state === 'null') {
    return { drawRoute: false, reason: NOT_FOUND_REASON };
  }
  return { drawRoute: false, reason: null };
}

/**
 * Headline for one station pin: that end's own name, else its address,
 * else a plain "Departure" / "Arrival". Never the leg label — with only
 * one end named, that would put the other station's name on this pin.
 */
export function transitEndpointLabel(
  end: { name: string | null; address: string | null },
  endpoint: 'origin' | 'destination',
): string {
  return end.name ?? end.address ?? (endpoint === 'origin' ? 'Departure' : 'Arrival');
}

/**
 * Headline for a leg in the Not-pinned list. Mirrors the rail's transit label
 * (build-rail-days.ts) so a leg reads the same everywhere.
 */
export function transitRouteLabel(
  data: { fromName?: string; toName?: string } | null,
  locationName: string | null,
): string {
  const from = data?.fromName?.trim();
  const to = data?.toName?.trim();
  if (from && to) return `${from} → ${to}`;
  if (from || to) return (from || to) as string;
  return locationName ?? 'Transit';
}
