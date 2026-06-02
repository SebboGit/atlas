import { describe, expect, it } from 'vitest';

import { CONTINENT_ORDER, continentForCode, tallyContinents } from './iso-continent';

describe('continentForCode', () => {
  it('maps codes to their continent', () => {
    expect(continentForCode('JP')).toBe('Asia');
    expect(continentForCode('FR')).toBe('Europe');
    expect(continentForCode('US')).toBe('North America');
    expect(continentForCode('BR')).toBe('South America');
    expect(continentForCode('AU')).toBe('Oceania');
    expect(continentForCode('ZA')).toBe('Africa');
    expect(continentForCode('AQ')).toBe('Antarctica');
  });

  it('assigns transcontinental states their conventional single continent', () => {
    expect(continentForCode('RU')).toBe('Europe');
    expect(continentForCode('TR')).toBe('Asia');
  });

  it('is case-insensitive', () => {
    expect(continentForCode('jp')).toBe('Asia');
    expect(continentForCode('Fr')).toBe('Europe');
  });

  it('returns null for unknown codes', () => {
    expect(continentForCode('XX')).toBeNull();
    expect(continentForCode('')).toBeNull();
  });
});

describe('tallyContinents', () => {
  it('counts per continent and returns them in CONTINENT_ORDER', () => {
    // Input order is deliberately scrambled; output must follow CONTINENT_ORDER.
    expect(tallyContinents(['FR', 'JP', 'US', 'DE'])).toEqual([
      { continent: 'Asia', count: 1 },
      { continent: 'Europe', count: 2 },
      { continent: 'North America', count: 1 },
    ]);
  });

  it('skips unknown codes without affecting the tally', () => {
    expect(tallyContinents(['JP', 'XX', 'ZZ'])).toEqual([{ continent: 'Asia', count: 1 }]);
  });

  it('prunes continents with no visited countries', () => {
    const result = tallyContinents(['JP']);
    expect(result).toHaveLength(1);
    expect(result.map((r) => r.continent)).not.toContain('Antarctica');
  });

  it('is case-insensitive when counting', () => {
    expect(tallyContinents(['jp', 'JP'])).toEqual([{ continent: 'Asia', count: 2 }]);
  });

  it('returns an empty tally for no codes', () => {
    expect(tallyContinents([])).toEqual([]);
  });

  it('orders a full sweep exactly as CONTINENT_ORDER', () => {
    const oneEach = ['ZA', 'JP', 'FR', 'US', 'BR', 'AU', 'AQ'];
    expect(tallyContinents(oneEach).map((r) => r.continent)).toEqual([...CONTINENT_ORDER]);
  });
});
