// Station-to-station routes for train / bus / ferry segments on the trip
// map (ADR-0019). Pure: given what the geocode cache knows about each
// end, decide whether a line is drawn and which single "Not pinned"
// reason (if any) the segment carries. The repo does the I/O.

// Leaf import, not the geocoding barrel: this module stays pure.
import { greatCircleKm, implausibleEnds } from '@/lib/geocoding/station-guard';
import type { TransitEndpointMode } from '@/lib/segments';

// Re-exported so the map's tests and callers keep one import site.
export { greatCircleKm, MAX_FALLBACK_KM } from '@/lib/geocoding/station-guard';

/** What the cache knows about one end of a leg. */
export type EndpointLookup =
  | { state: 'none' } // no name, address or Plus Code for this end
  | { state: 'null' } // the geocoder ran and found nothing
  | { state: 'miss' } // no cache row yet
  | {
      state: 'hit';
      lat: number;
      lng: number;
      /**
       * `geocode_cache.source` for this end's row — which rung of the
       * ladder produced the coordinates (ADR-0018). Absent for an
       * offline Plus Code decode, which reads no row.
       */
      source?: string | null;
      /**
       * True when this end was looked up as a `station:` key (ADR-0019)
       * — i.e. a bare station name, no address and no Plus Code.
       */
      station?: boolean;
    };

export const PENDING_REASON = 'Geocoding pending — try again in a moment.';
export const NOT_FOUND_REASON = "We couldn't find this place on the map.";
export const DEPARTURE_NOT_FOUND_REASON = "We couldn't find the departure point on the map.";
export const ARRIVAL_NOT_FOUND_REASON = "We couldn't find the arrival point on the map.";
// A station we DID place, but only by guessing (see MAX_FALLBACK_KM in
// geocoding/station-guard.ts). Its pin stays — it may well be right —
// but the line is withheld and the entry says what to do about it.
export const DEPARTURE_UNCERTAIN_REASON =
  'The departure point looks wrong — add its address or Plus Code.';
export const ARRIVAL_UNCERTAIN_REASON =
  'The arrival point looks wrong — add its address or Plus Code.';
export const ROUTE_UNCERTAIN_REASON = 'Both ends look wrong — add an address or Plus Code.';

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

export interface TransitRouteDecision {
  drawRoute: boolean;
  /** The one "Not pinned" reason for the segment, or null for none. */
  reason: string | null;
}

/**
 * Decide the line and the Not-pinned reason for one leg. Checked in
 * order: a pending end outranks everything (a refresh may still change
 * the picture); with two resolved ends the fallback guard runs BEFORE
 * the mode cap, so a leg that is both over its cap and built on a guess
 * gets the honest entry rather than the cap's silent no-entry; past
 * that, a line is drawn unless the ends are beyond the cap or on the
 * same spot; otherwise the reason names the end that couldn't be found.
 * A leg with only one end named gets no entry — its one pin shows, the
 * same as a flight with no origin airport.
 *
 * Every end that resolved keeps its pin. This function only decides the
 * line and the entry.
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
    // The guard needs the other end to measure against, so it only
    // applies once both ends resolved. A lone fallback pin keeps its
    // pin and its silence — no line asserts a journey from it.
    const doubtful = implausibleEnds(mode, origin, destination);
    if (doubtful.origin && doubtful.destination) {
      return { drawRoute: false, reason: ROUTE_UNCERTAIN_REASON };
    }
    if (doubtful.origin || doubtful.destination) {
      return {
        drawRoute: false,
        reason: doubtful.origin ? DEPARTURE_UNCERTAIN_REASON : ARRIVAL_UNCERTAIN_REASON,
      };
    }
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
