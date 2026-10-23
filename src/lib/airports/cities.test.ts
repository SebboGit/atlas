import { describe, expect, it } from 'vitest';

import { getAirportCity } from './cities';

describe('getAirportCity', () => {
  it('resolves well-known airports', () => {
    expect(getAirportCity('LHR')).toBe('London');
    expect(getAirportCity('PUQ')).toBe('Punta Arenas');
    expect(getAirportCity('HND')).toBe('Tokyo');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(getAirportCity('lhr')).toBe('London');
    expect(getAirportCity(' Puq ')).toBe('Punta Arenas');
  });

  it('returns null for non-IATA-shaped input', () => {
    expect(getAirportCity('LH')).toBeNull();
    expect(getAirportCity('LHRX')).toBeNull();
    expect(getAirportCity('London')).toBeNull();
  });

  it('returns null for empty / nullish input', () => {
    expect(getAirportCity('')).toBeNull();
    expect(getAirportCity(null)).toBeNull();
    expect(getAirportCity(undefined)).toBeNull();
  });

  it('returns null for IATA-shaped codes that arent in the snapshot', () => {
    expect(getAirportCity('XQX')).toBeNull();
  });

  it('unescapes upstream backslash-escaped apostrophes', () => {
    // airports.dat has `Fiti\'uta`.
    expect(getAirportCity('FTI')).toBe("Fiti'uta");
  });
});
