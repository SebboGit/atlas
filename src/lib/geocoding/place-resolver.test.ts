import { describe, expect, it, vi } from 'vitest';

import { PlaceResolver } from './place-resolver';
import type {
  Geocoder,
  GeocodeCandidate,
  GeocodeResult,
  GeocodeSearcher,
  ReverseGeocoder,
} from './types';

function deps(opts?: {
  forward?: (q: string) => Promise<GeocodeResult | null>;
  reverse?: (lat: number, lng: number) => Promise<string | null>;
}) {
  const forwardSpy = vi.fn(opts?.forward ?? (async () => null));
  const reverseSpy = vi.fn(opts?.reverse ?? (async () => null));
  const forward: Geocoder = { geocode: forwardSpy };
  const reverse: ReverseGeocoder = { reverse: reverseSpy };
  return { resolver: new PlaceResolver({ forward, reverse }), forwardSpy, reverseSpy };
}

describe('PlaceResolver — non-Plus-Code passthrough', () => {
  it('delegates straight to the forward geocoder for free-text addresses', async () => {
    const result: GeocodeResult = { lat: 1, lng: 2, displayName: 'Somewhere' };
    const { resolver, forwardSpy, reverseSpy } = deps({ forward: async () => result });

    expect(await resolver.geocode('123 Main St, Springfield')).toEqual(result);
    expect(forwardSpy).toHaveBeenCalledExactlyOnceWith('123 Main St, Springfield');
    expect(reverseSpy).not.toHaveBeenCalled();
  });

  it('returns null when the forward geocoder does', async () => {
    const { resolver } = deps({ forward: async () => null });
    expect(await resolver.geocode('jdklajdklaj')).toBeNull();
  });
});

describe('PlaceResolver — full Plus Code', () => {
  it('decodes offline and reverse-geocodes for the display name', async () => {
    const { resolver, forwardSpy, reverseSpy } = deps({
      reverse: async () => 'Tokyo Tower, Minato City, Japan',
    });

    const result = await resolver.geocode('8Q7XMPWG+5V');

    expect(result).not.toBeNull();
    expect(result!.displayName).toBe('Tokyo Tower, Minato City, Japan');
    // Coords come from offline decode — no forward call needed.
    expect(forwardSpy).not.toHaveBeenCalled();
    expect(reverseSpy).toHaveBeenCalledOnce();
    expect(Number.isFinite(result!.lat)).toBe(true);
    expect(Number.isFinite(result!.lng)).toBe(true);
  });

  it('falls back to a synthesised displayName when reverse returns null', async () => {
    const { resolver } = deps({ reverse: async () => null });

    const result = await resolver.geocode('8Q7XMPWG+5V');

    expect(result).not.toBeNull();
    expect(result!.displayName).toMatch(/^Plus Code 8Q7XMPWG\+5V$/);
    // Coords still present — the result is usable despite the reverse miss.
    expect(Number.isFinite(result!.lat)).toBe(true);
    expect(Number.isFinite(result!.lng)).toBe(true);
  });

  it('canonicalises case (lowercase input → uppercase code in displayName)', async () => {
    const { resolver } = deps({ reverse: async () => null });
    const result = await resolver.geocode('8q7xmpwg+5v');
    expect(result!.displayName).toBe('Plus Code 8Q7XMPWG+5V');
  });
});

describe('PlaceResolver — local Plus Code', () => {
  it('geocodes the anchor, lifts to a full code, then reverse-geocodes', async () => {
    const { resolver, forwardSpy, reverseSpy } = deps({
      forward: async () => ({ lat: 35.65, lng: 139.74, displayName: 'Minato City, Tokyo' }),
      reverse: async () => 'Recovered Place, Minato City, Tokyo, Japan',
    });

    const result = await resolver.geocode('MP7J+CV Minato City, Tokyo');

    expect(result).not.toBeNull();
    expect(result!.displayName).toBe('Recovered Place, Minato City, Tokyo, Japan');
    expect(forwardSpy).toHaveBeenCalledExactlyOnceWith('Minato City, Tokyo');
    expect(reverseSpy).toHaveBeenCalledOnce();
    // Recovered coords should be near the anchor.
    expect(Math.abs(result!.lat - 35.65)).toBeLessThan(0.5);
    expect(Math.abs(result!.lng - 139.74)).toBeLessThan(0.5);
  });

  it('returns null when the anchor itself cannot be resolved', async () => {
    const { resolver, forwardSpy, reverseSpy } = deps({
      forward: async () => null,
    });

    const result = await resolver.geocode('MP7J+CV Some Nonexistent Place');

    expect(result).toBeNull();
    expect(forwardSpy).toHaveBeenCalledOnce();
    expect(reverseSpy).not.toHaveBeenCalled();
  });

  it('returns null when the parser hands back a local code with no reference', async () => {
    // The schema rejects this at form time; the resolver is the second
    // line of defence. We construct the bare-local input directly to
    // exercise the inner branch.
    const { resolver, forwardSpy, reverseSpy } = deps();
    const result = await resolver.geocode('MP7J+CV');
    expect(result).toBeNull();
    expect(forwardSpy).not.toHaveBeenCalled();
    expect(reverseSpy).not.toHaveBeenCalled();
  });
});

describe('PlaceResolver — search (multi-candidate)', () => {
  const candidate: GeocodeCandidate = {
    lat: 35.6585,
    lng: 139.7454,
    displayName: 'Park Hyatt Tokyo, Shinjuku, Tokyo, Japan',
    name: 'Park Hyatt Tokyo',
    addressLabel: 'Park Hyatt Tokyo, Shinjuku, Tokyo, Japan',
    osmType: 'hotel',
    category: 'tourism',
    countryCode: 'JP',
  };

  it('delegates to the forward searcher and does NOT route through Plus Code parsing', async () => {
    const searchSpy = vi.fn(async () => [candidate]);
    const forward: Geocoder & GeocodeSearcher = {
      geocode: vi.fn(async () => null),
      search: searchSpy,
    };
    const resolver = new PlaceResolver({ forward, reverse: { reverse: vi.fn(async () => null) } });

    const out = await resolver.search('Park Hyatt Tokyo, Shinjuku, Japan', { limit: 3 });

    expect(out).toEqual([candidate]);
    expect(searchSpy).toHaveBeenCalledExactlyOnceWith('Park Hyatt Tokyo, Shinjuku, Japan', {
      limit: 3,
    });
    // geocode must not be touched — search is its own path.
    expect(forward.geocode).not.toHaveBeenCalled();
  });

  it('returns [] when the forward dependency cannot search (graceful degradation)', async () => {
    // Plain Geocoder, no `search` method — the picker degrades to empty
    // rather than throwing.
    const forward: Geocoder = { geocode: vi.fn(async () => null) };
    const resolver = new PlaceResolver({ forward, reverse: { reverse: vi.fn(async () => null) } });

    expect(await resolver.search('anything')).toEqual([]);
  });
});
