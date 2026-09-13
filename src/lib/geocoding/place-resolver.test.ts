import { describe, expect, it, vi } from 'vitest';

import { PlaceResolver } from './place-resolver';
import { STATION_OSM_TAGS } from './station-query';
import type {
  Geocoder,
  GeocodeCandidate,
  GeocodeResult,
  GeocodeSearcher,
  ReverseGeocoder,
  TagFilterOptions,
} from './types';

function deps(opts?: {
  forward?: (q: string) => Promise<GeocodeResult | null>;
  reverse?: (
    lat: number,
    lng: number,
  ) => Promise<{ displayName: string; city: string | null } | null>;
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
      reverse: async () => ({ displayName: 'Tokyo Tower, Minato City, Japan', city: 'Minato' }),
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
      reverse: async () => ({
        displayName: 'Recovered Place, Minato City, Tokyo, Japan',
        city: 'Minato',
      }),
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

describe('PlaceResolver — station keys (ADR-0019)', () => {
  const REVERSE: ReverseGeocoder = { reverse: async () => null };

  function named(name: string, lat = 35.6813, lng = 139.7667) {
    return { lat, lng, displayName: `${name}, Chiyoda`, city: 'Chiyoda', source: 'photon', name };
  }

  function stationDeps(opts: {
    tagged?: (query: string, cc: string | null | undefined) => ReturnType<typeof named>[];
    candidates?: (query: string, cc: string | null | undefined) => GeocodeCandidate[];
    fallback?: GeocodeResult | null;
  }) {
    const geocodeWithTags = vi.fn(async (query: string, o: TagFilterOptions) =>
      (opts.tagged ?? (() => []))(query, o.countryCode),
    );
    const searchWithTags = vi.fn(async (query: string, o: TagFilterOptions) =>
      (opts.candidates ?? (() => []))(query, o.countryCode),
    );
    const fallbackSpy = vi.fn(async (_query: string) => opts.fallback ?? null);
    const forwardSpy = vi.fn(async () => null);
    const resolver = new PlaceResolver({
      forward: { geocode: forwardSpy },
      reverse: REVERSE,
      stations: {
        tagged: { geocodeWithTags, searchWithTags },
        fallback: { geocode: fallbackSpy },
      },
    });
    return { resolver, geocodeWithTags, searchWithTags, fallbackSpy, forwardSpy };
  }

  it('returns the first tagged hit whose name agrees, tagged as photon-station', async () => {
    const { resolver, geocodeWithTags, fallbackSpy, forwardSpy } = stationDeps({
      tagged: (query) => (query === 'Tokyo' ? [named('Tōkyō')] : []),
    });

    const result = await resolver.geocode('station:train:jp:Tokyo Station');

    expect(result).toEqual({
      lat: 35.6813,
      lng: 139.7667,
      displayName: 'Tōkyō, Chiyoda',
      city: 'Chiyoda',
      source: 'photon-station',
    });
    // Raw name first (miss), then the stripped name with the country.
    expect(geocodeWithTags.mock.calls.map(([q, o]) => [q, o.countryCode])).toEqual([
      ['Tokyo Station', 'jp'],
      ['Tokyo', 'jp'],
    ]);
    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(forwardSpy).not.toHaveBeenCalled();
  });

  it('skips hits that name a different station and moves to the next rung', async () => {
    const { resolver, geocodeWithTags } = stationDeps({
      tagged: (query, cc) => {
        if (query === 'Tokyo Station') return [named('Shakujii-kōen')];
        if (cc === 'jp') return [named('Shinjuku')];
        return [named('Tōkyō')];
      },
    });

    const result = await resolver.geocode('station:train:jp:Tokyo Station');

    expect(result?.source).toBe('photon-station');
    expect(geocodeWithTags).toHaveBeenCalledTimes(3);
    expect(geocodeWithTags.mock.calls[2]![1].countryCode).toBeNull();
  });

  it('passes a hit that only contains the name and takes the exact match a later rung finds', async () => {
    const { resolver } = stationDeps({
      tagged: (query) =>
        query === 'Yokohama Station'
          ? [named('Mutsu-Yokohama Station', 41.0862, 141.2496)]
          : [named('Yokohama', 35.4658, 139.6223)],
    });

    const result = await resolver.geocode('station:train:jp:Yokohama Station');

    expect(result).toMatchObject({ lat: 35.4658, lng: 139.6223, source: 'photon-station' });
  });

  it('sends each mode its own category filter', async () => {
    const { resolver, geocodeWithTags, searchWithTags } = stationDeps({});

    await resolver.geocode('station:ferry:gb:Dover Ferry Terminal');
    await resolver.searchStation({
      mode: 'bus',
      countryCode: 'gb',
      name: 'Victoria Coach Station',
    });

    expect(geocodeWithTags.mock.calls.every(([, o]) => o.tags === STATION_OSM_TAGS.ferry)).toBe(
      true,
    );
    expect(searchWithTags.mock.calls.every(([, o]) => o.tags === STATION_OSM_TAGS.bus)).toBe(true);
    expect(searchWithTags).toHaveBeenCalled();
  });

  it('hands the RAW name to the fallback when every tagged rung misses', async () => {
    const fallbackHit: GeocodeResult = { lat: 1, lng: 2, displayName: 'Tokyo Station' };
    const { resolver, fallbackSpy } = stationDeps({ fallback: fallbackHit });

    expect(await resolver.geocode('station:train:jp:Tokyo Station')).toEqual(fallbackHit);
    expect(fallbackSpy).toHaveBeenCalledExactlyOnceWith('Tokyo Station');
  });

  it('never sends the stripped name to the fallback', async () => {
    const { resolver, fallbackSpy } = stationDeps({});
    await resolver.geocode('station:ferry:gb:Dover Ferry Terminal');
    expect(fallbackSpy.mock.calls.map(([q]) => q)).toEqual(['Dover Ferry Terminal']);
  });

  it('resolves a station key as its raw name when no station deps are wired', async () => {
    const { resolver, forwardSpy } = deps();
    await resolver.geocode('station:bus:-:Victoria Coach Station');
    expect(forwardSpy).toHaveBeenCalledExactlyOnceWith('Victoria Coach Station');
  });

  it('searchStation returns only agreeing candidates from the first rung that has any', async () => {
    const candidate = (name: string): GeocodeCandidate => ({
      lat: 0,
      lng: 0,
      displayName: name,
      name,
      addressLabel: name,
      osmType: 'station',
      category: 'railway',
      countryCode: 'JP',
    });
    const { resolver, searchWithTags } = stationDeps({
      candidates: (query) =>
        query === 'Kyoto Station'
          ? [candidate('Torokko Arashiyama')]
          : [candidate('Kyoto'), candidate('Nijō')],
    });

    const result = await resolver.searchStation(
      { mode: 'train', countryCode: 'jp', name: 'Kyoto Station' },
      { limit: 3 },
    );

    expect(result.map((c) => c.name)).toEqual(['Kyoto']);
    expect(searchWithTags).toHaveBeenCalledTimes(2);
  });

  it('searchStation returns [] without station deps', async () => {
    const { resolver } = deps();
    expect(
      await resolver.searchStation({ mode: 'train', countryCode: null, name: 'Kyoto' }),
    ).toEqual([]);
  });
});
