// Which IANA zone a place is in — for scheduling reminders (ADR-0020).
// Three sources, most precise first; the caller picks. `zoneAt` also
// runs at build time in scripts/fetch-airports.ts, filling airport zones
// upstream left blank; those reach the UI only as the airport's zone
// label, never as a clock conversion (ADR-0016).
//
// - Airport: the committed airport table's zone (flights).
// - Coordinates: an offline boundary lookup on a geocoded pin.
// - Country: only when every zone the country uses keeps the same
//   offsets, so the answer can't be hours off.

import tzLookup from '@photostructure/tz-lookup';

import { getAirportTimezone } from '@/lib/airports';

import countryZonesJson from './country-zones.json';
import { isKnownZone, tzOffsetMs } from './convert';

const countryZones = countryZonesJson as Record<string, string[]>;

// Where tzdata lists a zone the country doesn't officially use. China
// keeps one national time, but zone.tab also carries Asia/Urumqi (an
// informal Xinjiang time, UTC+6), which would otherwise make China read
// as multi-zone and lose its fallback.
const OFFICIAL_ZONE: Record<string, string> = {
  CN: 'Asia/Shanghai',
};

export function zoneForAirport(iata: string | null | undefined): string | null {
  const tz = getAirportTimezone(iata);
  return tz && isKnownZone(tz) ? tz : null;
}

// Boundary lookups that land in an informal zone, mapped to the official
// one. Xinjiang's informal UTC+6 is common in daily life, but bookings,
// timetables and flights there are printed in Beijing time.
const OFFICIAL_ALIAS: Record<string, string> = {
  'Asia/Urumqi': 'Asia/Shanghai',
};

export function zoneAt(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const found = tzLookup(lat, lng);
    const tz = OFFICIAL_ALIAS[found] ?? found;
    return isKnownZone(tz) ? tz : null;
  } catch {
    return null;
  }
}

const countryCache = new Map<string, string | null>();

/**
 * The country's zone when it is unambiguous, else null. "Unambiguous"
 * means every listed zone has the same UTC offset in mid-January and in
 * mid-July of the current year — so Germany (Berlin, Busingen) counts as
 * one zone, Spain (Madrid, Canary) does not.
 */
export function zoneForCountry(countryCode: string | null | undefined): string | null {
  const cc = countryCode?.trim().toUpperCase();
  if (!cc) return null;
  if (countryCache.has(cc)) return countryCache.get(cc) ?? null;

  let result: string | null = OFFICIAL_ZONE[cc] ?? null;
  if (!result) {
    const zones = (countryZones[cc] ?? []).filter(isKnownZone);
    const first = zones[0];
    if (first) {
      const year = new Date().getUTCFullYear();
      const probes = [Date.UTC(year, 0, 15, 12), Date.UTC(year, 6, 15, 12)];
      const signature = (tz: string) => probes.map((at) => tzOffsetMs(tz, at)).join(',');
      const expected = signature(first);
      result = zones.every((tz) => signature(tz) === expected) ? first : null;
    }
  }
  countryCache.set(cc, result);
  return result;
}
