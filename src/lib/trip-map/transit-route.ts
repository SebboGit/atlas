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
  | {
      state: 'hit';
      lat: number;
      lng: number;
      /**
       * `geocode_cache.source` for this end's row — which rung of the
       * ladder produced the coordinates (ADR-0018). Absent for an
       * offline Plus Code decode and for rows written before the
       * column carried a ladder value.
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
// A station we DID place, but only by guessing (see MAX_FALLBACK_KM).
// Its pin stays — it may well be right — but the line is withheld and
// the entry says what to do about it.
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

// Tighter caps for an end that only the free-text ladder could place.
// When every tagged station rung misses, the resolver sends the bare
// name on without the segment's country (ADR-0019 §3), so a "Pudeto"
// can land in the wrong province and the mode cap above — sized for
// wrong-continent hits — still draws a confident line to it. Past
// these distances the line is withheld and the leg says which end
// looks wrong; both pins stay, because the guess may be right and a
// pin claims far less than a line does.
//
// The population is wider than the rare true failure: a name with no
// comparable Latin words (北京南, Москва-Пассажирская) never reaches the
// tagged rungs at all, and ADR-0019's probes found "Berlin Hbf"-class
// names fall back and land correctly. So these numbers govern every
// such leg, and a false positive costs only the line plus an entry —
// which is why they sit well above an ordinary long leg. An end given
// an address or a Plus Code is trusted at any distance, and setting
// one is the fix the entry names. Initial values; tuning them doesn't
// need a new ADR.
export const MAX_FALLBACK_KM: Readonly<Record<TransitEndpointMode, number>> = {
  // A long day's ride, up to the Beijing–Kunming class.
  train: 2500,
  // Overnight coaches, up to the Buenos Aires–Bariloche class.
  bus: 1800,
  // Past any overnight crossing; catches the 1,065 km Pudeto case.
  ferry: 900,
};

// Ladder rungs that mean "free text answered, not a station lookup".
// 'photon-station' is a tag-filtered, name-guarded station hit and
// 'plus-code' an offline decode — both trusted. An unknown or empty
// source is a row from before the ladder recorded one: trusted too,
// so existing correct pins keep their lines.
const FALLBACK_SOURCES: ReadonlySet<string> = new Set(['photon', 'nominatim']);

/** True when this end is a bare station name that only free text could place. */
function isFallbackHit(end: Extract<EndpointLookup, { state: 'hit' }>): boolean {
  return end.station === true && FALLBACK_SOURCES.has(end.source ?? '');
}

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
    const km = greatCircleKm(origin, destination);
    const originFallback = isFallbackHit(origin);
    const destinationFallback = isFallbackHit(destination);
    // The guard needs the other end to measure against, so it only
    // applies once both ends resolved. A lone fallback pin keeps its
    // pin and its silence — no line asserts a journey from it.
    if ((originFallback || destinationFallback) && km > MAX_FALLBACK_KM[mode]) {
      if (originFallback && destinationFallback) {
        return { drawRoute: false, reason: ROUTE_UNCERTAIN_REASON };
      }
      return {
        drawRoute: false,
        reason: originFallback ? DEPARTURE_UNCERTAIN_REASON : ARRIVAL_UNCERTAIN_REASON,
      };
    }
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
