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

  it('names the city an overridden airport serves', () => {
    expect(getAirportCity('SVQ')).toBe('Seville');
    expect(getAirportCity('KEF')).toBe('Reykjavík');
    expect(getAirportCity('TLL')).toBe('Tallinn');
    expect(getAirportCity('KBP')).toBe('Kyiv');
    expect(getAirportCity('SCN')).toBe('Saarbrücken');
    expect(getAirportCity('CLJ')).toBe('Cluj-Napoca');
  });

  it('title-cases an all-caps upstream city', () => {
    expect(getAirportCity('ISC')).toBe("St Mary's");
    expect(getAirportCity('MGM')).toBe('Montgomery');
  });

  it('drops a trailing airport word from the city', () => {
    expect(getAirportCity('ZQN')).toBe('Queenstown');
    expect(getAirportCity('JGO')).toBe('Qeqertarsuaq');
  });

  it('names the city of an airport newer than OpenFlights', () => {
    expect(getAirportCity('BER')).toBe('Berlin');
    expect(getAirportCity('PKX')).toBe('Beijing');
    expect(getAirportCity('NQZ')).toBe('Astana');
  });

  it('names the city of an airport upstream had no timezone for', () => {
    expect(getAirportCity('DOH')).toBe('Doha');
    expect(getAirportCity('HYD')).toBe('Hyderabad');
  });

  it('replaces a city that belongs to another airport', () => {
    expect(getAirportCity('AMN')).toBe('Alma');
    expect(getAirportCity('OEL')).toBe('Oryol');
  });

  it('unescapes upstream backslash-escaped apostrophes', () => {
    // airports.dat has `Fiti\'uta`.
    expect(getAirportCity('FTI')).toBe("Fiti'uta");
  });
});
