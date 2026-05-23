// Nominatim-backed implementation of Geocoder. See ADR-0010.
//
// - Public endpoint by default; same interface points at a self-hosted
//   instance via NOMINATIM_URL with no code change.
// - 1 req/s ceiling enforced by an in-process token bucket. Trips
//   through the bucket are FIFO via promise chaining so concurrent
//   callers can't all "win" the same slot.
// - Never throws. Every failure mode (network, 4xx, 5xx, malformed
//   JSON, empty result) returns null.
// - Logs cache-correlation metadata only — never the raw query or the
//   response body. The query is reduced to an 8-char SHA-1 prefix
//   purely for grepping co-located logs.

import { createHash } from 'node:crypto';

import { log } from '@/lib/log';

import type { Geocoder, GeocodeResult } from './types';

const DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org';
const DEFAULT_MIN_INTERVAL_MS = 1100;
// Hard ceiling on how long a single fetch can hang before we give up
// and emit a `network-error`. The public Nominatim endpoint
// occasionally stalls; default undici fetch timeout is ~5 min, which
// would tie up a worker slot behind a single slow request and
// (more importantly) make a misconfigured self-hosted Nominatim look
// like the whole app froze. 10 s is generous for a healthy provider
// and tight enough that a hang surfaces fast.
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface NominatimGeocoderOptions {
  /**
   * Base URL of the Nominatim instance. Defaults to the public OSM
   * endpoint. Override to point at a self-hosted container (see
   * ADR-0010 "When to revisit") with no other code changes.
   */
  baseUrl?: string;
  /**
   * Full `User-Agent` value to send. Nominatim's policy requires an
   * identifying agent; the factory builds this from
   * `Atlas/<version> (<NOMINATIM_CONTACT_EMAIL>)`. Callers
   * constructing the geocoder directly must provide their own.
   */
  userAgent: string;
  /**
   * Minimum milliseconds between outbound calls. Defaults to 1100ms
   * — a hair above Nominatim's 1 req/s ceiling to leave clock-skew
   * headroom. Tests inject 0 to skip the wait.
   */
  minIntervalMs?: number;
  /**
   * Per-request timeout in ms. Defaults to 10 000. Aborted requests
   * surface as a `network-error` log line and return null — same
   * shape as any other transport failure.
   */
  requestTimeoutMs?: number;
  /** Test seam — production uses global fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam — production uses Date.now. */
  now?: () => number;
  /** Test seam — production uses setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

interface NominatimSearchHit {
  lat?: unknown;
  lon?: unknown;
  display_name?: unknown;
}

export class NominatimGeocoder implements Geocoder {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /**
   * Wall-clock timestamp at which the next outbound request is allowed
   * to fire. Concurrent callers each bump this synchronously before
   * awaiting their wait, so the bucket serialises FIFO without an
   * explicit promise chain.
   */
  private nextAvailableAt = 0;

  constructor(opts: NominatimGeocoderOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.userAgent = opts.userAgent;
    this.minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  async geocode(query: string): Promise<GeocodeResult | null> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return null;

    await this.acquireSlot();

    const queryHash = shortHash(trimmed);
    const url = this.buildUrl(trimmed);

    // AbortController + setTimeout pair to bound the fetch. Cleared
    // in `finally` so a fast response doesn't leak a pending timer
    // until the runtime GCs it.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.requestTimeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          'user-agent': this.userAgent,
          accept: 'application/json',
          // Nominatim recommends English for canonical display_name
          // unless the caller has a reason otherwise. Reduces locale
          // drift on cache keys we look up by normalized query.
          'accept-language': 'en',
        },
        signal: abort.signal,
      });
    } catch {
      // AbortError and any other network failure collapse into the
      // same log line — callers don't distinguish; the cache layer
      // applies the negative-hit TTL either way.
      log.warn({ queryHash, reason: 'network-error' }, 'geocoding.nominatim.failed');
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      log.warn({ queryHash, reason: `http-${res.status}` }, 'geocoding.nominatim.failed');
      return null;
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      log.warn({ queryHash, reason: 'invalid-json' }, 'geocoding.nominatim.failed');
      return null;
    }

    if (!Array.isArray(payload) || payload.length === 0) {
      log.info({ queryHash, found: false }, 'geocoding.nominatim.ok');
      return null;
    }

    const top = payload[0] as NominatimSearchHit;
    const lat = parseCoord(top.lat);
    const lng = parseCoord(top.lon);
    const displayName = typeof top.display_name === 'string' ? top.display_name : null;

    if (lat === null || lng === null || displayName === null) {
      log.warn({ queryHash, reason: 'malformed-hit' }, 'geocoding.nominatim.failed');
      return null;
    }

    log.info({ queryHash, found: true }, 'geocoding.nominatim.ok');
    return { lat, lng, displayName };
  }

  // Token-bucket gate. Each call reserves the next slot synchronously
  // (before any `await`), so a burst of concurrent callers fan out as
  // `t`, `t + interval`, `t + 2·interval`, … without two of them
  // racing for the same window. minIntervalMs=0 short-circuits.
  private async acquireSlot(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = this.now();
    const startAt = Math.max(now, this.nextAvailableAt);
    this.nextAvailableAt = startAt + this.minIntervalMs;
    const wait = startAt - now;
    if (wait > 0) await this.sleep(wait);
  }

  private buildUrl(query: string): string {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '1',
    });
    return `${this.baseUrl}/search?${params.toString()}`;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCoord(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function shortHash(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 8);
}

/**
 * Build a NominatimGeocoder from environment variables. The constructor
 * itself is pure — only this factory reads `process.env`, so tests
 * instantiate the geocoder with explicit options.
 *
 * Required env:
 *   - NOMINATIM_CONTACT_EMAIL — operator address baked into User-Agent
 *     per Nominatim's usage policy. Throwing on missing is deliberate
 *     (CLAUDE.md: never send unattributed requests).
 *
 * Optional env:
 *   - NOMINATIM_URL — override the public endpoint (e.g. self-hosted).
 *
 * Reads the app version from package.json's bundled APP_VERSION env
 * if present; otherwise falls back to "0.0.0-dev" so a missing build
 * step doesn't surface as a runtime crash on the geocoder.
 */
export function createNominatimGeocoder(): NominatimGeocoder {
  const contact = process.env.NOMINATIM_CONTACT_EMAIL;
  if (!contact || contact.trim() === '') {
    throw new Error(
      'NOMINATIM_CONTACT_EMAIL is not set — required by the Nominatim usage policy. See ADR-0010.',
    );
  }
  const version = process.env.npm_package_version ?? '0.0.0-dev';
  const baseUrl = process.env.NOMINATIM_URL;

  return new NominatimGeocoder({
    userAgent: `Atlas/${version} (${contact.trim()})`,
    ...(baseUrl ? { baseUrl } : {}),
  });
}
