import { afterEach, describe, expect, it, vi } from 'vitest';

import * as cities from '@/lib/airports/cities';

import { airportPlace, latitudePlace } from './places';

afterEach(() => {
  vi.restoreAllMocks();
});

// Every airport in the snapshot has a city today, so the country fallback
// is reached by taking the city away.
function withoutCities() {
  vi.spyOn(cities, 'getAirportCity').mockReturnValue(null);
}

describe('airportPlace', () => {
  it('names the city a known airport serves', () => {
    expect(airportPlace('LHR')).toBe('London');
  });

  it('falls back to the country without a city', () => {
    withoutCities();
    expect(airportPlace('LHR')).toBe('United Kingdom');
  });

  it('is null for anything that is not a known IATA code', () => {
    expect(airportPlace('ZZZ')).toBeNull();
    expect(airportPlace('lhr')).toBeNull();
    expect(airportPlace('Shinjuku')).toBeNull();
  });
});

describe('latitudePlace', () => {
  it('names an airport by its city and keeps the code apart', () => {
    expect(latitudePlace({ label: 'PUQ', airport: true })).toEqual({
      label: 'Punta Arenas',
      code: 'PUQ',
    });
  });

  it('adds the country to an airport code without a city', () => {
    withoutCities();
    expect(latitudePlace({ label: 'PUQ', airport: true })).toEqual({ label: 'PUQ, Chile' });
  });

  it('shows an unknown airport code as it stands', () => {
    expect(latitudePlace({ label: 'ZZZ', airport: true })).toEqual({ label: 'ZZZ' });
  });

  it('leaves a location name alone, even one shaped like a code', () => {
    expect(latitudePlace({ label: 'CAN', airport: false })).toEqual({ label: 'CAN' });
    expect(latitudePlace({ label: 'Torres del Paine', airport: false })).toEqual({
      label: 'Torres del Paine',
    });
  });
});
