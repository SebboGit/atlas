// Static IATA → WGS84 coordinates lookup, server-only.
//
// Kept apart from `./index` on purpose: `iata-airports.json` reaches the
// browser through the segment forms, which import `@/lib/airports` from
// client components. Coordinates are only used on the server (the trip
// map's flight pins and arcs, the stats page's distances and records),
// so they live in their own snapshot and this module must only be
// imported from server code — importing it from a `'use client'` file
// would ship the ~330 KB table to every visitor.
//
// Source data is `iata-airport-coords.json` in this directory, written by
// `scripts/fetch-airports.ts` from the same OpenFlights rows as the main
// snapshot (CLAUDE.md guardrail #13 / ADR-0009), rounded to 5 decimal
// places (~1 m).

import coordsData from './iata-airport-coords.json';

interface AirportCoords {
  lat: number;
  lng: number;
}

// A code is missing when the upstream row had malformed or out-of-range
// coords; its timezone and country can still be in the main snapshot.
const COORDS: Readonly<Record<string, AirportCoords>> = coordsData as Record<string, AirportCoords>;

// IATA airport codes are always 3 letters.
const IATA_AIRPORT = /^[A-Z]{3}$/;

/**
 * Resolve a 3-letter IATA airport code to WGS84 coordinates
 * (e.g. "SGN" → `{ lat: 10.819, lng: 106.652 }`). Returns `null`
 * when the input isn't IATA-shaped, isn't in the table, or the
 * airport row had no usable coords in the snapshot.
 *
 * Used by the trip-detail map to pin flight airports and draw arcs,
 * and by the stats page for distance flown and the north/south
 * records. Callers should treat null as "no point" — silently omit
 * rather than placing the airport at a fallback like (0, 0).
 */
export function getAirportCoords(
  iata: string | null | undefined,
): { lat: number; lng: number } | null {
  if (!iata) return null;
  const code = iata.trim().toUpperCase();
  if (!IATA_AIRPORT.test(code)) return null;
  const entry = COORDS[code];
  if (!entry) return null;
  return { lat: entry.lat, lng: entry.lng };
}
