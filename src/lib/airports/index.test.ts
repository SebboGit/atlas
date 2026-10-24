import { describe, expect, it } from 'vitest';

import { getAirportCoords } from './coords';
import { getAirportCountry, getAirportTimezone } from './index';

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

  it('tells the two Congos apart', () => {
    // OpenFlights writes "Congo (Kinshasa)" and "Congo (Brazzaville)";
    // without the qualifier both read "Congo" (CG).
    expect(getAirportCountry('FIH')).toBe('CD'); // Kinshasa
    expect(getAirportCountry('FBM')).toBe('CD'); // Lubumbashi
    expect(getAirportCountry('GOM')).toBe('CD'); // Goma
    expect(getAirportCountry('BZV')).toBe('CG'); // Brazzaville
    // Tagged "Congo (Kinshasa)" upstream, but in the Republic of the Congo.
    expect(getAirportCountry('OUE')).toBe('CG'); // Ouesso
    expect(getAirportCountry('FTX')).toBe('CG'); // Owando
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

describe('IST timezone (regression: issue #86)', () => {
  // OpenFlights ships the new Istanbul Airport (IST, ICAO LTFM) with a
  // null tz_database_time_zone, which dropped it from the snapshot
  // entirely. scripts/fetch-airports.ts now derives the zone from the
  // row's coordinates while keeping its own country and coords.
  it('resolves IST despite the upstream null timezone', () => {
    expect(getAirportTimezone('IST')).toBe('Europe/Istanbul');
    expect(getAirportCountry('IST')).toBe('TR');
    const coords = getAirportCoords('IST');
    expect(coords).not.toBeNull();
    expect(coords!.lat).toBeCloseTo(41.3, 0);
    expect(coords!.lng).toBeCloseTo(28.75, 0);
  });
});

describe('airports newer than OpenFlights', () => {
  // Beijing Daxing has an upstream row with a null timezone (derived from
  // its coordinates, like IST); Berlin Brandenburg has no upstream row at
  // all and comes from EXTRA_AIRPORTS.
  it('resolves PKX (Beijing Daxing)', () => {
    expect(getAirportTimezone('PKX')).toBe('Asia/Shanghai');
    expect(getAirportCountry('PKX')).toBe('CN');
    const coords = getAirportCoords('PKX');
    expect(coords!.lat).toBeCloseTo(39.51, 1);
    expect(coords!.lng).toBeCloseTo(116.41, 1);
  });

  it('resolves BER (Berlin Brandenburg)', () => {
    expect(getAirportTimezone('BER')).toBe('Europe/Berlin');
    expect(getAirportCountry('BER')).toBe('DE');
    const coords = getAirportCoords('BER');
    expect(coords!.lat).toBeCloseTo(52.36, 1);
    expect(coords!.lng).toBeCloseTo(13.5, 1);
  });

  it("resolves NQZ (Astana's code since 2020)", () => {
    expect(getAirportTimezone('NQZ')).toBe('Asia/Almaty');
    expect(getAirportCountry('NQZ')).toBe('KZ');
    const coords = getAirportCoords('NQZ');
    expect(coords!.lat).toBeCloseTo(51.03, 1);
    expect(coords!.lng).toBeCloseTo(71.47, 1);
    // The old code stays for older trips.
    expect(getAirportCountry('TSE')).toBe('KZ');
  });

  it('keeps the airports BER replaced, for older trips', () => {
    expect(getAirportTimezone('TXL')).toBe('Europe/Berlin');
    expect(getAirportTimezone('SXF')).toBe('Europe/Berlin');
  });
});

describe('timezones derived from coordinates', () => {
  // Upstream leaves the zone blank on ~550 rows; the script fills it from
  // the coordinates, and IATA_TZ_OVERRIDES corrects border cases.
  it('resolves airports upstream had no zone for', () => {
    expect(getAirportTimezone('DOH')).toBe('Asia/Qatar');
    expect(getAirportCountry('DOH')).toBe('QA');
    expect(getAirportTimezone('HYD')).toBe('Asia/Kolkata');
    expect(getAirportCountry('HYD')).toBe('IN');
    expect(getAirportTimezone('IKU')).toBe('Asia/Bishkek');
    expect(getAirportCountry('IKU')).toBe('KG');
  });

  it("keeps a border airport in its own country's zone", () => {
    // Tezu's coordinates fall on the Myanmar side of the lookup's boundary.
    expect(getAirportTimezone('TEI')).toBe('Asia/Kolkata');
    expect(getAirportCountry('TEI')).toBe('IN');
    expect(getAirportTimezone('YXQ')).toBe('America/Whitehorse');
  });

  it("keeps a border airport in its own region's zone", () => {
    // Same country, the neighbouring state's or oblast's zone.
    expect(getAirportTimezone('DKV')).toBe('Australia/Darwin');
    expect(getAirportTimezone('TLK')).toBe('Asia/Yakutsk');
  });

  it("corrects a row that carries another airport's country", () => {
    expect(getAirportCountry('OEL')).toBe('RU');
    expect(getAirportTimezone('OEL')).toBe('Europe/Moscow');
    expect(getAirportCountry('EMP')).toBe('US'); // upstream Germany
    expect(getAirportCountry('LND')).toBe('US'); // upstream Germany
    expect(getAirportCountry('OCN')).toBe('US'); // upstream Australia
    expect(getAirportCountry('BPE')).toBe('CN'); // upstream Burma
  });
});
