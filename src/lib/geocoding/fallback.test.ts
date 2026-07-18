import { describe, expect, it, vi } from 'vitest';

import { FallbackGeocoder } from './fallback';
import type { GeocodeCandidate, GeocodeResult } from './types';

function provider(overrides: { geocode?: GeocodeResult | null; search?: GeocodeCandidate[] }) {
  return {
    geocode: vi.fn().mockResolvedValue(overrides.geocode ?? null),
    search: vi.fn().mockResolvedValue(overrides.search ?? []),
  };
}

const PHOTON_HIT: GeocodeResult = {
  lat: 35.6895,
  lng: 139.6917,
  displayName: 'Park Hyatt Tokyo, Shinjuku, Tokyo, Japan',
  source: 'photon',
};

const NOMINATIM_HIT: GeocodeResult = {
  lat: 48.85,
  lng: 2.29,
  displayName: 'Somewhere, Paris, France',
  source: 'nominatim',
};

const CANDIDATE: GeocodeCandidate = {
  lat: 1,
  lng: 2,
  displayName: 'X',
  name: 'X',
  addressLabel: 'X',
  osmType: null,
  category: null,
  countryCode: null,
};

describe('FallbackGeocoder.geocode', () => {
  it('returns the primary hit without touching the secondary', async () => {
    const primary = provider({ geocode: PHOTON_HIT });
    const secondary = provider({ geocode: NOMINATIM_HIT });

    const result = await new FallbackGeocoder(primary, secondary).geocode('q');

    expect(result).toEqual(PHOTON_HIT);
    expect(secondary.geocode).not.toHaveBeenCalled();
  });

  it('falls through to the secondary on a primary null', async () => {
    const primary = provider({ geocode: null });
    const secondary = provider({ geocode: NOMINATIM_HIT });

    const result = await new FallbackGeocoder(primary, secondary).geocode('q');

    expect(result).toEqual(NOMINATIM_HIT);
    expect(primary.geocode).toHaveBeenCalledWith('q');
    expect(secondary.geocode).toHaveBeenCalledWith('q');
  });

  it('returns null when both providers miss', async () => {
    const primary = provider({ geocode: null });
    const secondary = provider({ geocode: null });

    expect(await new FallbackGeocoder(primary, secondary).geocode('q')).toBeNull();
  });
});

describe('FallbackGeocoder.search', () => {
  it('returns primary candidates without touching the secondary', async () => {
    const primary = provider({ search: [CANDIDATE] });
    const secondary = provider({ search: [] });

    const out = await new FallbackGeocoder(primary, secondary).search('q', { limit: 3 });

    expect(out).toEqual([CANDIDATE]);
    expect(secondary.search).not.toHaveBeenCalled();
  });

  it('falls through to the secondary when the primary returns []', async () => {
    const primary = provider({ search: [] });
    const secondary = provider({ search: [CANDIDATE] });

    const out = await new FallbackGeocoder(primary, secondary).search('q', { limit: 3 });

    expect(out).toEqual([CANDIDATE]);
    expect(primary.search).toHaveBeenCalledWith('q', { limit: 3 });
    expect(secondary.search).toHaveBeenCalledWith('q', { limit: 3 });
  });
});

describe('FallbackReverse', () => {
  const HIT_WITH_CITY = { displayName: 'Somewhere, Riverport City', city: 'Riverport City' };
  const HIT_NO_CITY = { displayName: 'Nearest Feature', city: null };

  function reverser(result: { displayName: string; city: string | null } | null) {
    return { reverse: vi.fn().mockResolvedValue(result) };
  }

  it('returns the primary when it names a city', async () => {
    const primary = reverser(HIT_WITH_CITY);
    const secondary = reverser(HIT_NO_CITY);
    const { FallbackReverse } = await import('./fallback');

    const out = await new FallbackReverse(primary, secondary).reverse(1, 2);
    expect(out).toEqual(HIT_WITH_CITY);
    expect(secondary.reverse).not.toHaveBeenCalled();
  });

  it('consults the secondary when the primary hit lacks a city', async () => {
    const primary = reverser(HIT_NO_CITY);
    const secondary = reverser(HIT_WITH_CITY);
    const { FallbackReverse } = await import('./fallback');

    const out = await new FallbackReverse(primary, secondary).reverse(1, 2);
    expect(out).toEqual(HIT_WITH_CITY);
  });

  it('keeps the city-less primary hit when the secondary has nothing better', async () => {
    const primary = reverser(HIT_NO_CITY);
    const secondary = reverser(null);
    const { FallbackReverse } = await import('./fallback');

    const out = await new FallbackReverse(primary, secondary).reverse(1, 2);
    expect(out).toEqual(HIT_NO_CITY);
  });
});
