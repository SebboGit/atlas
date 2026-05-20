import { describe, expect, it } from 'vitest';

import { getAirportCoords, getAirportCountry, getAirportTimezone } from './index';

describe('getAirportTimezone', () => {
  it('resolves well-known airports', () => {
    expect(getAirportTimezone('SGN')).toBe('Asia/Saigon');
    expect(getAirportTimezone('MUC')).toBe('Europe/Berlin');
    expect(getAirportTimezone('LHR')).toBe('Europe/London');
    expect(getAirportTimezone('JFK')).toBe('America/New_York');
    expect(getAirportTimezone('HND')).toBe('Asia/Tokyo');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(getAirportTimezone('sgn')).toBe('Asia/Saigon');
    expect(getAirportTimezone(' SGN ')).toBe('Asia/Saigon');
    expect(getAirportTimezone('Sgn')).toBe('Asia/Saigon');
  });

  it('returns null for non-IATA-shaped input', () => {
    expect(getAirportTimezone('SG')).toBeNull();
    expect(getAirportTimezone('SGNX')).toBeNull();
    expect(getAirportTimezone('123')).toBeNull();
    expect(getAirportTimezone('Saigon')).toBeNull();
  });

  it('returns null for empty / nullish input', () => {
    expect(getAirportTimezone('')).toBeNull();
    expect(getAirportTimezone('   ')).toBeNull();
    expect(getAirportTimezone(null)).toBeNull();
    expect(getAirportTimezone(undefined)).toBeNull();
  });

  it('returns null for IATA-shaped codes that arent in the snapshot', () => {
    // Picking codes unlikely to be assigned. If OpenFlights ever
    // assigns them, the assertion is "miss returns null" — that
    // contract holds regardless.
    expect(getAirportTimezone('XQX')).toBeNull();
  });

  it('returns a parseable IANA timezone identifier', () => {
    // Smoke-test that the snapshot's values are accepted by the
    // platform's Intl machinery. Catches a regression where the
    // generator script accidentally captures an empty / "U" /
    // "Etc/GMT+9" mishash.
    const tz = getAirportTimezone('SGN');
    expect(tz).not.toBeNull();
    expect(() =>
      new Intl.DateTimeFormat('en-GB', { timeZone: tz ?? 'UTC' }).format(new Date()),
    ).not.toThrow();
  });
});

describe('getAirportCountry', () => {
  it('resolves well-known airports to ISO 3166-1 alpha-2 codes', () => {
    expect(getAirportCountry('SGN')).toBe('VN');
    expect(getAirportCountry('MUC')).toBe('DE');
    expect(getAirportCountry('LHR')).toBe('GB');
    expect(getAirportCountry('JFK')).toBe('US');
    expect(getAirportCountry('HND')).toBe('JP');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(getAirportCountry('sgn')).toBe('VN');
    expect(getAirportCountry(' SGN ')).toBe('VN');
    expect(getAirportCountry('Sgn')).toBe('VN');
  });

  it('handles dissolved-country IATA overrides', () => {
    // OpenFlights tags these as "Netherlands Antilles"; the script
    // overrides them per IATA to the modern successor states.
    expect(getAirportCountry('CUR')).toBe('CW'); // Curaçao
    expect(getAirportCountry('SXM')).toBe('SX'); // Sint Maarten
    expect(getAirportCountry('BON')).toBe('BQ'); // Bonaire (BES)
  });

  it('returns null for non-IATA-shaped input', () => {
    expect(getAirportCountry('SG')).toBeNull();
    expect(getAirportCountry('SGNX')).toBeNull();
    expect(getAirportCountry('123')).toBeNull();
    expect(getAirportCountry('Saigon')).toBeNull();
  });

  it('returns null for empty / nullish input', () => {
    expect(getAirportCountry('')).toBeNull();
    expect(getAirportCountry('   ')).toBeNull();
    expect(getAirportCountry(null)).toBeNull();
    expect(getAirportCountry(undefined)).toBeNull();
  });

  it('returns null for IATA-shaped codes that arent in the snapshot', () => {
    expect(getAirportCountry('XQX')).toBeNull();
  });
});

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
