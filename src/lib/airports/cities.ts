// Static IATA → city lookup, server-only.
//
// Kept apart from `./index` on purpose: `iata-airports.json` reaches the
// browser through the segment forms, which import `@/lib/airports` from
// client components. City names are only shown on server-rendered pages
// (the stats records), so they live in their own snapshot and this module
// must only be imported from server code — importing it from a
// `'use client'` file would ship the ~120 KB table to every visitor.
//
// Source data is `iata-airport-cities.json` in this directory, written by
// `scripts/fetch-airports.ts` from the same OpenFlights rows as the main
// snapshot (CLAUDE.md guardrail #13 / ADR-0009). The script tidies
// upstream's city column (all-caps values title-cased, a trailing
// "International" / "Airport" dropped) and overrides popular airports
// it names wrongly (SVQ Seville, KEF Reykjavík); the long tail keeps
// upstream's spelling, diacritics missing and all.

import citiesData from './iata-airport-cities.json';

const CITIES: Readonly<Record<string, string>> = citiesData as Record<string, string>;

// IATA airport codes are always 3 letters.
const IATA_AIRPORT = /^[A-Z]{3}$/;

/**
 * Resolve a 3-letter IATA airport code to the city it serves
 * (e.g. "LHR" → "London"). Returns `null` when the input isn't
 * IATA-shaped, isn't in the table, or is empty. Case-insensitive.
 */
export function getAirportCity(iata: string | null | undefined): string | null {
  if (!iata) return null;
  const code = iata.trim().toUpperCase();
  if (!IATA_AIRPORT.test(code)) return null;
  return CITIES[code] ?? null;
}
