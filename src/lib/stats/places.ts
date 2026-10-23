// Readable names for the airports the records point at. An airport is
// named by the city it serves from the server-only city snapshot ("Punta
// Arenas" for PUQ), falling back to its country for a code the snapshot
// has no city for. Only labels the stats repo marks as airports are
// looked up — a location the user named "CAN" stays "CAN". Server-only,
// like `@/lib/airports/cities`.

import { getAirportCountry } from '@/lib/airports';
import { getAirportCity } from '@/lib/airports/cities';
import { countryName } from '@/lib/countries';

const IATA = /^[A-Z]{3}$/;

function airportNames(code: string): { city: string | null; country: string | null } {
  if (!IATA.test(code)) return { city: null, country: null };
  const cc = getAirportCountry(code);
  return { city: getAirportCity(code), country: cc ? countryName(cc) : null };
}

/** The city an airport serves ("London" for LHR), else its country, or null. */
export function airportPlace(code: string): string | null {
  const { city, country } = airportNames(code);
  return city ?? country;
}

/**
 * A latitude extreme's place. An airport reads as its city with the code
 * kept apart (`{ label: 'Punta Arenas', code: 'PUQ' }`), else the code
 * with its country (`{ label: 'PUQ, Chile' }`); a location name is shown
 * as it stands, even when it looks like a code.
 */
export function latitudePlace(extreme: { label: string; airport: boolean }): {
  label: string;
  code?: string;
} {
  const { label, airport } = extreme;
  if (!airport) return { label };
  const { city, country } = airportNames(label);
  if (city) return { label: city, code: label };
  return { label: country ? `${label}, ${country}` : label };
}
