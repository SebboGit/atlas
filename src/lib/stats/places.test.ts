import { describe, expect, it } from 'vitest';

import { airportCountryName, placeName } from './places';

describe('airportCountryName', () => {
  it('names the country of a known airport', () => {
    expect(airportCountryName('LHR')).toBe('United Kingdom');
  });

  it('is null for anything that is not a known IATA code', () => {
    expect(airportCountryName('ZZZ')).toBeNull();
    expect(airportCountryName('Shinjuku')).toBeNull();
  });
});

describe('placeName', () => {
  it('adds the country to an airport code', () => {
    expect(placeName('PUQ')).toBe('PUQ, Chile');
  });

  it('leaves a location name alone', () => {
    expect(placeName('Torres del Paine')).toBe('Torres del Paine');
  });
});
