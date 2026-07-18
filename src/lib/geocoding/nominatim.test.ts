import { describe, expect, it } from 'vitest';

import { NominatimGeocoder } from './nominatim';

const USER_AGENT = 'Atlas/0.0.0-test (test@example.com)';

function queuedFetch(responses: Array<() => Response | Promise<Response>>): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; headers: Headers }>;
} {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const queue = [...responses];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = new Headers(init?.headers ?? {});
    calls.push({ url, headers });
    const next = queue.shift();
    if (!next) throw new Error('queuedFetch ran out of responses');
    return next();
  };

  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeGeocoder(opts: {
  fetchImpl: typeof fetch;
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  return new NominatimGeocoder({
    userAgent: USER_AGENT,
    fetchImpl: opts.fetchImpl,
    minIntervalMs: opts.minIntervalMs ?? 0,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  });
}

describe('NominatimGeocoder.geocode', () => {
  it('returns lat/lng/displayName from the top hit', async () => {
    const { fetchImpl, calls } = queuedFetch([
      () =>
        jsonResponse([
          { lat: '48.8588443', lon: '2.2943506', display_name: 'Eiffel Tower, Paris, France' },
          { lat: '0', lon: '0', display_name: 'should be ignored — second result' },
        ]),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const result = await geocoder.geocode('Eiffel Tower');

    expect(result).toEqual({
      lat: 48.8588443,
      lng: 2.2943506,
      displayName: 'Eiffel Tower, Paris, France',
      source: 'nominatim',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('q=Eiffel+Tower');
    expect(calls[0]!.url).toContain('format=jsonv2');
    expect(calls[0]!.url).toContain('limit=1');
  });

  it('sends User-Agent and accept-language headers', async () => {
    const { fetchImpl, calls } = queuedFetch([() => jsonResponse([])]);
    const geocoder = makeGeocoder({ fetchImpl });

    await geocoder.geocode('anywhere');

    expect(calls[0]!.headers.get('user-agent')).toBe(USER_AGENT);
    expect(calls[0]!.headers.get('accept-language')).toBe('en');
  });

  it('returns null for empty / whitespace-only queries without calling fetch', async () => {
    const { fetchImpl, calls } = queuedFetch([]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.geocode('')).toBeNull();
    expect(await geocoder.geocode('   ')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null for an empty result array (no result)', async () => {
    const { fetchImpl } = queuedFetch([() => jsonResponse([])]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.geocode('jdklajdklaj')).toBeNull();
  });

  it('returns null on non-2xx response', async () => {
    const { fetchImpl } = queuedFetch([() => jsonResponse({ error: 'rate-limited' }, 429)]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.geocode('anywhere')).toBeNull();
  });

  it('returns null on network error', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.geocode('anywhere')).toBeNull();
  });

  it('aborts after requestTimeoutMs and returns null', async () => {
    // fetch implementation that honours the AbortSignal — same shape
    // undici uses in real life. We resolve only if the signal is
    // aborted (the abort raises an error here which is what bubbles
    // up to the geocoder's catch and produces the null return).
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });

    const geocoder = new (await import('./nominatim')).NominatimGeocoder({
      userAgent: USER_AGENT,
      fetchImpl,
      minIntervalMs: 0,
      requestTimeoutMs: 5,
    });

    const result = await geocoder.geocode('anywhere');
    expect(result).toBeNull();
  });

  it('returns null on non-JSON body', async () => {
    const { fetchImpl } = queuedFetch([() => new Response('<!doctype html>oops', { status: 200 })]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.geocode('anywhere')).toBeNull();
  });

  it('returns null when the top hit is malformed (missing lat/lon/display_name)', async () => {
    const { fetchImpl } = queuedFetch([() => jsonResponse([{ lat: 'foo', lon: '1' }])]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.geocode('anywhere')).toBeNull();
  });

  it('coerces numeric lat/lon to numbers when the API returns them as such', async () => {
    const { fetchImpl } = queuedFetch([
      () => jsonResponse([{ lat: 1.5, lon: -2.5, display_name: 'somewhere' }]),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const result = await geocoder.geocode('anywhere');
    expect(result).toEqual({ lat: 1.5, lng: -2.5, displayName: 'somewhere', source: 'nominatim' });
  });
});

describe('NominatimGeocoder.search', () => {
  it('maps rich hits to candidates: name/addressLabel/osmType/category/countryCode', async () => {
    const { fetchImpl, calls } = queuedFetch([
      () =>
        jsonResponse([
          {
            lat: '35.6585',
            lon: '139.7454',
            display_name: 'Park Hyatt Tokyo, 3-7-1-2 Nishi-Shinjuku, Shinjuku, Tokyo, Japan',
            type: 'hotel',
            class: 'tourism',
            namedetails: { name: 'Park Hyatt Tokyo' },
            address: { country_code: 'jp' },
          },
        ]),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const candidates = await geocoder.search('Park Hyatt Tokyo');

    expect(candidates).toEqual([
      {
        lat: 35.6585,
        lng: 139.7454,
        displayName: 'Park Hyatt Tokyo, 3-7-1-2 Nishi-Shinjuku, Shinjuku, Tokyo, Japan',
        name: 'Park Hyatt Tokyo',
        addressLabel: 'Park Hyatt Tokyo, 3-7-1-2 Nishi-Shinjuku, Shinjuku, Tokyo, Japan',
        osmType: 'hotel',
        category: 'tourism',
        countryCode: 'JP',
      },
    ]);
    // Search-specific params present.
    expect(calls[0]!.url).toContain('addressdetails=1');
    expect(calls[0]!.url).toContain('namedetails=1');
    expect(calls[0]!.url).toContain('format=jsonv2');
    expect(calls[0]!.url).toContain('limit=3');
  });

  it('falls back to the first comma-part of display_name when namedetails is absent', async () => {
    const { fetchImpl } = queuedFetch([
      () =>
        jsonResponse([
          {
            lat: '3.1478',
            lon: '101.7117',
            display_name: 'Damascus, Bukit Bintang, Kuala Lumpur, Malaysia',
            type: 'restaurant',
            class: 'amenity',
            address: { country_code: 'my' },
          },
        ]),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const [first] = await geocoder.search('Damascus, Bukit Bintang');

    expect(first!.name).toBe('Damascus');
    expect(first!.osmType).toBe('restaurant');
    expect(first!.category).toBe('amenity');
    expect(first!.countryCode).toBe('MY');
  });

  it('uppercases the country_code and tolerates a missing one (null)', async () => {
    const { fetchImpl } = queuedFetch([
      () =>
        jsonResponse([
          {
            lat: '1',
            lon: '2',
            display_name: 'Somewhere',
            type: 'attraction',
            class: 'tourism',
            // no address block at all
          },
        ]),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const [first] = await geocoder.search('somewhere');
    expect(first!.countryCode).toBeNull();
    expect(first!.name).toBe('Somewhere');
  });

  it('sets osmType/category to null when the hit omits type/class', async () => {
    const { fetchImpl } = queuedFetch([
      () => jsonResponse([{ lat: '1', lon: '2', display_name: 'Plain place' }]),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const [first] = await geocoder.search('plain');
    expect(first!.osmType).toBeNull();
    expect(first!.category).toBeNull();
    expect(first!.name).toBe('Plain place');
  });

  it('skips malformed hits (missing coords / display_name) but keeps usable ones', async () => {
    const { fetchImpl } = queuedFetch([
      () =>
        jsonResponse([
          { lat: 'not-a-number', lon: '2', display_name: 'bad coords' },
          { lat: '1', lon: '2' }, // missing display_name
          { lat: '3', lon: '4', display_name: 'Good place', type: 'cafe', class: 'amenity' },
        ]),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const candidates = await geocoder.search('mixed');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.name).toBe('Good place');
  });

  it('skips a hit with an empty-string coordinate rather than pinning it at (0,0)', async () => {
    // `Number('')` is 0 (finite) — without an explicit guard an empty
    // lat/lon would pass as a phantom candidate at the equator/meridian.
    const { fetchImpl } = queuedFetch([
      () =>
        jsonResponse([
          { lat: '', lon: '2', display_name: 'empty lat' },
          { lat: '5', lon: '   ', display_name: 'whitespace lon' },
          { lat: '6', lon: '7', display_name: 'Real place' },
        ]),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const candidates = await geocoder.search('coords');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ lat: 6, lng: 7, name: 'Real place' });
  });

  it('caps the returned candidates at the requested limit', async () => {
    const { fetchImpl, calls } = queuedFetch([
      () =>
        jsonResponse([
          { lat: '1', lon: '1', display_name: 'A' },
          { lat: '2', lon: '2', display_name: 'B' },
          { lat: '3', lon: '3', display_name: 'C' },
        ]),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const candidates = await geocoder.search('many', { limit: 2 });
    expect(candidates).toHaveLength(2);
    expect(calls[0]!.url).toContain('limit=2');
  });

  it('clamps an over-large limit to the hard ceiling of 3', async () => {
    const { fetchImpl, calls } = queuedFetch([() => jsonResponse([])]);
    const geocoder = makeGeocoder({ fetchImpl });

    await geocoder.search('anything', { limit: 50 });
    expect(calls[0]!.url).toContain('limit=3');
  });

  it('returns [] for empty / whitespace-only queries without calling fetch', async () => {
    const { fetchImpl, calls } = queuedFetch([]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.search('')).toEqual([]);
    expect(await geocoder.search('   ')).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('returns [] for an empty result array', async () => {
    const { fetchImpl } = queuedFetch([() => jsonResponse([])]);
    const geocoder = makeGeocoder({ fetchImpl });
    expect(await geocoder.search('jdklajdklaj')).toEqual([]);
  });

  it('returns [] on a non-array (garbage) body', async () => {
    const { fetchImpl } = queuedFetch([() => jsonResponse({ error: 'oops' })]);
    const geocoder = makeGeocoder({ fetchImpl });
    expect(await geocoder.search('anywhere')).toEqual([]);
  });

  it('returns [] on non-2xx response', async () => {
    const { fetchImpl } = queuedFetch([() => jsonResponse({ error: 'rate-limited' }, 429)]);
    const geocoder = makeGeocoder({ fetchImpl });
    expect(await geocoder.search('anywhere')).toEqual([]);
  });

  it('returns [] on network error', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const geocoder = makeGeocoder({ fetchImpl });
    expect(await geocoder.search('anywhere')).toEqual([]);
  });

  it('returns [] on non-JSON body', async () => {
    const { fetchImpl } = queuedFetch([() => new Response('<!doctype html>', { status: 200 })]);
    const geocoder = makeGeocoder({ fetchImpl });
    expect(await geocoder.search('anywhere')).toEqual([]);
  });

  it('shares the throttle bucket with geocode()', async () => {
    const { fetchImpl } = queuedFetch([() => jsonResponse([]), () => jsonResponse([])]);
    const FIXED_NOW = 1_000_000;
    const sleeps: number[] = [];
    const geocoder = makeGeocoder({
      fetchImpl,
      minIntervalMs: 1100,
      now: () => FIXED_NOW,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await Promise.all([geocoder.geocode('a'), geocoder.search('b')]);

    const nonZero = sleeps.filter((s) => s > 0);
    expect(nonZero).toEqual([1100]);
  });
});

describe('NominatimGeocoder.reverse', () => {
  it('returns display_name from the /reverse endpoint payload', async () => {
    const { fetchImpl, calls } = queuedFetch([
      () =>
        jsonResponse({
          lat: '35.6762',
          lon: '139.6503',
          display_name: 'Tokyo Tower, 4 Chome-2-8 Shibakoen, Minato City, Tokyo, Japan',
        }),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const result = await geocoder.reverse(35.6762, 139.6503);

    expect(result).toBe('Tokyo Tower, 4 Chome-2-8 Shibakoen, Minato City, Tokyo, Japan');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/reverse?');
    expect(calls[0]!.url).toContain('lat=35.6762');
    expect(calls[0]!.url).toContain('lon=139.6503');
    expect(calls[0]!.url).toContain('zoom=18');
    expect(calls[0]!.url).toContain('format=jsonv2');
  });

  it('returns null without calling fetch for non-finite coordinates', async () => {
    const { fetchImpl, calls } = queuedFetch([]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.reverse(Number.NaN, 0)).toBeNull();
    expect(await geocoder.reverse(0, Number.POSITIVE_INFINITY)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null when the endpoint signals out-of-coverage with an error payload', async () => {
    const { fetchImpl } = queuedFetch([() => jsonResponse({ error: 'Unable to geocode' })]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.reverse(0, 0)).toBeNull();
  });

  it('returns null on non-2xx response', async () => {
    const { fetchImpl } = queuedFetch([() => jsonResponse({ error: 'rate-limited' }, 429)]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.reverse(35, 139)).toBeNull();
  });

  it('returns null on network error', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.reverse(35, 139)).toBeNull();
  });

  it('returns null on non-JSON body', async () => {
    const { fetchImpl } = queuedFetch([() => new Response('<!doctype html>oops', { status: 200 })]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.reverse(35, 139)).toBeNull();
  });

  it('shares the throttle bucket with geocode()', async () => {
    const { fetchImpl } = queuedFetch([
      () => jsonResponse([]),
      () => jsonResponse({ display_name: 'somewhere' }),
    ]);
    const FIXED_NOW = 1_000_000;
    const sleeps: number[] = [];
    const geocoder = makeGeocoder({
      fetchImpl,
      minIntervalMs: 1100,
      now: () => FIXED_NOW,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await Promise.all([geocoder.geocode('a'), geocoder.reverse(35, 139)]);

    // First caller waits 0, second waits 1100 — proves reverse() shares
    // the same `nextAvailableAt` as geocode() rather than maintaining
    // its own bucket.
    const nonZero = sleeps.filter((s) => s > 0);
    expect(nonZero).toEqual([1100]);
  });
});

describe('NominatimGeocoder throttle', () => {
  it('serialises concurrent callers at minIntervalMs spacing', async () => {
    const { fetchImpl } = queuedFetch([
      () => jsonResponse([]),
      () => jsonResponse([]),
      () => jsonResponse([]),
    ]);

    // Frozen clock — the throttle reserves slots synchronously per
    // caller, so as long as `now()` is stable each caller computes
    // its wait against the next reserved slot. The recorded sleep
    // durations are the assertion target.
    const FIXED_NOW = 1_000_000;
    const sleeps: number[] = [];
    const geocoder = makeGeocoder({
      fetchImpl,
      minIntervalMs: 1100,
      now: () => FIXED_NOW,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    // Fire three concurrent calls. The first reserves t=now and
    // waits 0; the second reserves t=now+1100 (waits 1100); the
    // third reserves t=now+2200 (waits 2200). Slots are taken in
    // the synchronous prefix before any sleep yields, so the
    // reservations are deterministic across the burst.
    await Promise.all([geocoder.geocode('a'), geocoder.geocode('b'), geocoder.geocode('c')]);

    const nonZero = sleeps.filter((s) => s > 0);
    expect(nonZero).toEqual([1100, 2200]);
  });

  it('does not throttle when minIntervalMs is 0', async () => {
    const { fetchImpl, calls } = queuedFetch([() => jsonResponse([]), () => jsonResponse([])]);
    const sleeps: number[] = [];
    const geocoder = makeGeocoder({
      fetchImpl,
      minIntervalMs: 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await Promise.all([geocoder.geocode('a'), geocoder.geocode('b')]);
    expect(sleeps).toHaveLength(0);
    expect(calls).toHaveLength(2);
  });
});
