import { describe, expect, it } from 'vitest';

import { getAirportCoords } from './coords';
import airportsData from './iata-airports.json';

describe('getAirportCoords', () => {
  it('resolves well-known airports to coords inside the right country', () => {
    // We don't assert exact lat/lng (OpenFlights values shift between
    // refreshes); we just bound them inside each airport's country.
    const sgn = getAirportCoords('SGN');
    expect(sgn).not.toBeNull();
    expect(sgn!.lat).toBeGreaterThan(10);
    expect(sgn!.lat).toBeLessThan(11);
    expect(sgn!.lng).toBeGreaterThan(106);
    expect(sgn!.lng).toBeLessThan(107);

    const lhr = getAirportCoords('LHR');
    expect(lhr).not.toBeNull();
    expect(lhr!.lat).toBeCloseTo(51.47, 0);
    expect(lhr!.lng).toBeCloseTo(-0.45, 0);
  });

  it('is case-insensitive', () => {
    expect(getAirportCoords('sgn')).not.toBeNull();
    expect(getAirportCoords(' SGN ')).not.toBeNull();
  });

  it('returns null for non-IATA-shaped or missing input', () => {
    expect(getAirportCoords('SG')).toBeNull();
    expect(getAirportCoords('Saigon')).toBeNull();
    expect(getAirportCoords('')).toBeNull();
    expect(getAirportCoords(null)).toBeNull();
    expect(getAirportCoords(undefined)).toBeNull();
    expect(getAirportCoords('XQX')).toBeNull();
  });

  it('returns coords inside the valid WGS84 range', () => {
    for (const iata of ['JFK', 'MUC', 'HND', 'SYD', 'GRU']) {
      const c = getAirportCoords(iata);
      expect(c).not.toBeNull();
      expect(Math.abs(c!.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c!.lng)).toBeLessThanOrEqual(180);
    }
  });
});

describe('the snapshot the browser gets', () => {
  // `iata-airports.json` reaches client components through `./index`;
  // coordinates stay in the server-only snapshot behind `./coords`.
  it('carries no coordinates', () => {
    const withCoords = Object.entries(airportsData).filter(
      ([, entry]) => 'lat' in entry || 'lng' in entry,
    );
    expect(withCoords).toEqual([]);
  });
});
