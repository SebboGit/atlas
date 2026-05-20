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
    expect(result).toEqual({ lat: 1.5, lng: -2.5, displayName: 'somewhere' });
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
