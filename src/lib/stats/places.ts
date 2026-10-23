// Readable names for the places the records point at. The static airport
// snapshot carries each airport's country but no city name, so an IATA
// code is shown with its country ("LHR, United Kingdom").

import { getAirportCountry } from '@/lib/airports';
import { countryName } from '@/lib/countries';

const IATA = /^[A-Z]{3}$/;

/** The country an airport is in ("United Kingdom" for LHR), or null. */
export function airportCountryName(code: string): string | null {
  const cc = IATA.test(code) ? getAirportCountry(code) : null;
  return cc ? countryName(cc) : null;
}

/**
 * A latitude record's place: a segment's location name as it stands, or
 * an airport's IATA code with its country.
 */
export function placeName(label: string): string {
  const country = airportCountryName(label);
  return country ? `${label}, ${country}` : label;
}
