import { describe, expect, it } from 'vitest';

import { PhotonGeocoder } from './photon';

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

function makeGeocoder(opts: { fetchImpl: typeof fetch; minIntervalMs?: number }) {
  return new PhotonGeocoder({
    userAgent: USER_AGENT,
    fetchImpl: opts.fetchImpl,
    minIntervalMs: opts.minIntervalMs ?? 0,
  });
}

// A realistic Photon hit: GeoJSON feature, coordinates as [lon, lat].
function feature(props: Record<string, unknown>, lon = 139.6917, lat = 35.6895) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: props,
  };
}

describe('PhotonGeocoder.geocode', () => {
  it('returns the top hit with a synthesised display name and photon source', async () => {
    const { fetchImpl, calls } = queuedFetch([
      () =>
        jsonResponse({
          type: 'FeatureCollection',
          features: [
            feature({
              name: 'Park Hyatt Tokyo',
              street: 'Nishishinjuku',
              city: 'Shinjuku',
              state: 'Tokyo',
              country: 'Japan',
              countrycode: 'JP',
              osm_key: 'tourism',
              osm_value: 'hotel',
            }),
          ],
        }),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const result = await geocoder.geocode('Park Hyatt Tokyo, Shinjuku');

    expect(result).toEqual({
      lat: 35.6895,
      lng: 139.6917,
      displayName: 'Park Hyatt Tokyo, Nishishinjuku, Shinjuku, Tokyo, Japan',
      city: 'Shinjuku',
      source: 'photon',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/api/?');
    expect(calls[0]!.url).toContain('q=Park+Hyatt+Tokyo%2C+Shinjuku');
    expect(calls[0]!.url).toContain('limit=1');
    expect(calls[0]!.url).toContain('lang=en');
    expect(calls[0]!.headers.get('user-agent')).toBe(USER_AGENT);
  });

  it('reads GeoJSON coordinates as [lon, lat] — not transposed', async () => {
    const { fetchImpl } = queuedFetch([
      () =>
        jsonResponse({
          features: [feature({ name: 'Somewhere', country: 'Chile' }, -72.5, -51.0)],
        }),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const result = await geocoder.geocode('Somewhere');

    expect(result?.lat).toBe(-51.0);
    expect(result?.lng).toBe(-72.5);
  });

  it('collapses consecutive duplicate parts in the display name', async () => {
    // Photon often repeats the city as the district.
    const { fetchImpl } = queuedFetch([
      () =>
        jsonResponse({
          features: [feature({ name: 'Café X', district: 'Lisboa', city: 'Lisboa' })],
        }),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect((await geocoder.geocode('Café X'))?.displayName).toBe('Café X, Lisboa');
  });

  it('joins street and housenumber into one part', async () => {
    const { fetchImpl } = queuedFetch([
      () =>
        jsonResponse({
          features: [
            feature({ name: 'Pastéis de Belém', street: 'Rua de Belém', housenumber: '84' }),
          ],
        }),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect((await geocoder.geocode('Pastéis de Belém'))?.displayName).toBe(
      'Pastéis de Belém, Rua de Belém 84',
    );
  });

  it('returns null on an empty feature list', async () => {
    const { fetchImpl } = queuedFetch([() => jsonResponse({ features: [] })]);
    expect(await makeGeocoder({ fetchImpl }).geocode('nope')).toBeNull();
  });

  it('returns null on HTTP error, network error, and invalid JSON', async () => {
    const { fetchImpl } = queuedFetch([
      () => jsonResponse({}, 503),
      () => {
        throw new Error('ECONNREFUSED');
      },
      () => new Response('<html>not json</html>', { status: 200 }),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.geocode('a')).toBeNull();
    expect(await geocoder.geocode('b')).toBeNull();
    expect(await geocoder.geocode('c')).toBeNull();
  });

  it('returns null for a hit without usable coordinates or without any name part', async () => {
    const { fetchImpl } = queuedFetch([
      () =>
        jsonResponse({
          features: [{ geometry: { coordinates: ['x', 'y'] }, properties: { name: 'Broken' } }],
        }),
      () => jsonResponse({ features: [feature({})] }),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.geocode('bad coords')).toBeNull();
    expect(await geocoder.geocode('no props')).toBeNull();
  });

  it('short-circuits empty and whitespace-only queries without a request', async () => {
    const { fetchImpl, calls } = queuedFetch([]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.geocode('')).toBeNull();
    expect(await geocoder.geocode('   ')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('PhotonGeocoder.search', () => {
  it('maps features to candidates with osm_key/osm_value and uppercased country code', async () => {
    const { fetchImpl, calls } = queuedFetch([
      () =>
        jsonResponse({
          features: [
            feature({
              name: 'Ippudo Ginza',
              city: 'Chuo',
              state: 'Tokyo',
              country: 'Japan',
              countrycode: 'jp',
              osm_key: 'amenity',
              osm_value: 'restaurant',
            }),
          ],
        }),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const candidates = await geocoder.search('Ippudo Ginza', { limit: 3 });

    expect(candidates).toEqual([
      {
        lat: 35.6895,
        lng: 139.6917,
        displayName: 'Ippudo Ginza, Chuo, Tokyo, Japan',
        name: 'Ippudo Ginza',
        addressLabel: 'Ippudo Ginza, Chuo, Tokyo, Japan',
        osmType: 'restaurant',
        category: 'amenity',
        countryCode: 'JP',
      },
    ]);
    expect(calls[0]!.url).toContain('limit=3');
  });

  it('skips malformed hits without sinking the result set', async () => {
    const { fetchImpl } = queuedFetch([
      () =>
        jsonResponse({
          features: [
            { geometry: null, properties: { name: 'No geometry' } },
            feature({ name: 'Good Hit', country: 'Japan' }),
          ],
        }),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const candidates = await geocoder.search('x');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.name).toBe('Good Hit');
  });

  it('a null entry in features[] is skipped, not thrown (no-throw contract)', async () => {
    // The optional chain in featureCoords guards `geometry`, not the
    // feature itself — a bare null in the array must degrade to a
    // skipped hit for both geocode() and search().
    const { fetchImpl } = queuedFetch([
      () => jsonResponse({ features: [null, feature({ name: 'Survivor', country: 'Japan' })] }),
      () => jsonResponse({ features: [null] }),
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    const candidates = await geocoder.search('x');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.name).toBe('Survivor');
    expect(await geocoder.geocode('y')).toBeNull();
  });

  it('returns [] for empty queries and on transport failure', async () => {
    const { fetchImpl } = queuedFetch([
      () => {
        throw new Error('offline');
      },
    ]);
    const geocoder = makeGeocoder({ fetchImpl });

    expect(await geocoder.search('')).toEqual([]);
    expect(await geocoder.search('x')).toEqual([]);
  });
});
