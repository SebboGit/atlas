// How far to trust a station key's cached coordinates (ADR-0019,
// amended by #144 and #164). Pure: a ladder rung and, for a leg with
// both ends resolved, the distance between them in; a verdict out.
//
// One verdict, several readers. The trip map withholds its route line
// and names the end that looks wrong; the segment inspector and card
// drop that end's Plus Code badge, so a guess never deep-links Google
// Maps (the same reason Decision 8 keeps cached coordinates out of the
// Directions link); the reminder sweep won't take a time zone from it;
// and /stats keeps it out of the north/south extremes. Each reader owns
// what it does with the answer.

import type { TransitEndpointMode } from '@/lib/segments/transit-endpoints';

import { tryParseStationQuery } from './station-query';

// Tighter caps for an end that only the free-text ladder could place.
// When every tagged station rung misses, the resolver sends the bare
// name on without the segment's country (ADR-0019 §3), so a "Pudeto"
// can land in the wrong province and the trip map's mode cap — sized
// for wrong-continent hits — still draws a confident line to it. Past
// these distances the end is implausible: the map withholds the line
// and says which end looks wrong, and the inspector drops its badge.
// Both pins stay, because the guess may be right and a pin claims far
// less than a line does.
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
// Every cached hit names its rung — `geocode_cache.source` is NOT NULL
// and cache.ts writes 'nominatim' when a provider names none — so on a
// station key this is 'photon-station' (a tag-filtered, name-guarded
// hit, trusted) or one of these two. An absent source means no cache
// row was read at all: an offline Plus Code decode, also trusted.
const FALLBACK_SOURCES: ReadonlySet<string> = new Set(['photon', 'nominatim']);

/**
 * True when `query` is a bare station name (a `station:` key — no
 * address, no Plus Code) and its cache row came from the country-free
 * free-text fallback rather than a tagged station rung.
 */
export function isGuessedStation(query: string, source: string | null | undefined): boolean {
  return tryParseStationQuery(query) !== null && FALLBACK_SOURCES.has(source ?? '');
}

/** One resolved end of a leg, as the guard sees it. */
export interface GuardedEnd {
  lat: number;
  lng: number;
  /**
   * `geocode_cache.source` for this end's row; absent when no row was
   * read (an offline Plus Code decode).
   */
  source?: string | null;
  /** True when this end was looked up as a `station:` key. */
  station?: boolean;
}

/** Which ends of a leg are too doubtful to point anyone at. */
export interface ImplausibleEnds {
  origin: boolean;
  destination: boolean;
}

/**
 * The guard's verdict for one train / bus / ferry leg. An end is
 * implausible when it is a guessed station and sits further from the
 * other end than the mode's fallback threshold — both of them when
 * neither end is better than a guess. It needs the other end to
 * measure against, so a leg with only one end resolved is never
 * flagged: a lone guessed pin keeps its silence.
 */
export function implausibleEnds(
  mode: TransitEndpointMode,
  origin: GuardedEnd | null,
  destination: GuardedEnd | null,
): ImplausibleEnds {
  if (!origin || !destination) return { origin: false, destination: false };
  const originGuessed = isGuessedEnd(origin);
  const destinationGuessed = isGuessedEnd(destination);
  if (!originGuessed && !destinationGuessed) return { origin: false, destination: false };
  if (greatCircleKm(origin, destination) <= MAX_FALLBACK_KM[mode]) {
    return { origin: false, destination: false };
  }
  return { origin: originGuessed, destination: destinationGuessed };
}

function isGuessedEnd(end: GuardedEnd): boolean {
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
