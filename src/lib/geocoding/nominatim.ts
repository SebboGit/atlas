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

import type {
  Geocoder,
  GeocodeCandidate,
  GeocodeResult,
  GeocodeSearcher,
  ReverseGeocoder,
} from './types';

const DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org';
const DEFAULT_MIN_INTERVAL_MS = 1100;
// Default candidate count for the interactive picker. Three is enough
// to disambiguate the common "is this the right branch?" case without
// turning the panel into a scroll exercise. Hard-capped on the way out
// regardless of what a caller requests, since Nominatim will happily
// return more.
const DEFAULT_SEARCH_LIMIT = 3;
const MAX_SEARCH_LIMIT = 3;
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
  address?: Record<string, unknown> | null;
}

// Richer hit shape returned when we ask for addressdetails + namedetails.
// All fields optional / unknown — Nominatim's response is not a contract
// and we validate field-by-field before trusting anything.
interface NominatimRichHit {
  lat?: unknown;
  lon?: unknown;
  display_name?: unknown;
  /** Nominatim feature type, e.g. "restaurant", "hotel". */
  type?: unknown;
  /** Nominatim feature class / category, e.g. "amenity", "tourism". */
  class?: unknown;
  name?: unknown;
  namedetails?: { name?: unknown } | null;
  address?: { country_code?: unknown } | null;
}

export class NominatimGeocoder implements Geocoder, ReverseGeocoder, GeocodeSearcher {
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
    const payload = await this.fetchJson(
      this.buildUrl(trimmed),
      queryHash,
      'geocoding.nominatim.failed',
    );
    if (payload === undefined) return null;

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
    return { lat, lng, displayName, city: pickCity(top.address), source: 'nominatim' };
  }

  /**
   * Reverse geocode: lat/lng → `display_name`. Same throttle, same
   * no-throw contract, same logging shape as {@link geocode}. Used by
   * the Plus Code path to put a real place name on cache rows whose
   * coordinates came from offline decoding.
   *
   * Non-finite coordinates short-circuit to null without touching the
   * bucket — defence in depth; the resolver shouldn't pass anything
   * the library wouldn't accept.
   */
  async reverse(
    lat: number,
    lng: number,
  ): Promise<{ displayName: string; city: string | null } | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    await this.acquireSlot();

    // Hash the formatted coord pair for log correlation across hits
    // and misses on the same point. Six decimals ≈ 11 cm, plenty of
    // precision to keep distinct lookups distinct.
    const queryHash = shortHash(`${lat.toFixed(6)},${lng.toFixed(6)}`);
    const payload = await this.fetchJson(
      this.buildReverseUrl(lat, lng),
      queryHash,
      'geocoding.nominatim.reverse_failed',
    );
    if (payload === undefined) return null;

    // The /reverse endpoint returns a single object (not an array).
    // Out-of-coverage lookups return `{ error: "..." }` with no
    // `display_name` — treat as a miss.
    if (typeof payload !== 'object' || payload === null) {
      log.info({ queryHash, found: false }, 'geocoding.nominatim.reverse_ok');
      return null;
    }
    const obj = payload as { display_name?: unknown; address?: Record<string, unknown> | null };
    if (typeof obj.display_name !== 'string' || obj.display_name === '') {
      log.info({ queryHash, found: false }, 'geocoding.nominatim.reverse_ok');
      return null;
    }

    log.info({ queryHash, found: true }, 'geocoding.nominatim.reverse_ok');
    return { displayName: obj.display_name, city: pickCity(obj.address) };
  }

  /**
   * Multi-candidate forward search for the interactive address picker.
   * Requests up to `limit` hits (capped at {@link MAX_SEARCH_LIMIT})
   * with `addressdetails` + `namedetails` so each candidate carries a
   * short name, a country code, and a feature type for the UI.
   *
   * Same throttle, same no-throw contract, same hashed-query-only
   * logging as {@link geocode}. Every failure mode — empty/garbage
   * query, network error, 4xx/5xx, non-array body — returns `[]`.
   * Individual malformed hits are skipped, not fatal, so one bad row
   * doesn't sink an otherwise-usable result set.
   */
  async search(query: string, opts?: { limit?: number }): Promise<GeocodeCandidate[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const limit = clampSearchLimit(opts?.limit);

    await this.acquireSlot();

    const queryHash = shortHash(trimmed);
    const payload = await this.fetchJson(
      this.buildSearchUrl(trimmed, limit),
      queryHash,
      'geocoding.nominatim.search_failed',
    );
    if (payload === undefined) return [];

    if (!Array.isArray(payload)) {
      log.warn({ queryHash, reason: 'not-array' }, 'geocoding.nominatim.search_failed');
      return [];
    }

    const candidates: GeocodeCandidate[] = [];
    for (const raw of payload) {
      const candidate = parseCandidate(raw);
      if (candidate) candidates.push(candidate);
      if (candidates.length >= limit) break;
    }

    log.info({ queryHash, count: candidates.length }, 'geocoding.nominatim.search_ok');
    return candidates;
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

  /**
   * Shared request scaffolding for {@link geocode}, {@link reverse}, and
   * {@link search}: a timeout-bounded fetch (AbortController + timer,
   * cleared in `finally` so a fast response doesn't leak a pending
   * timer), the Nominatim headers, and the failure logging (network /
   * non-2xx / invalid-JSON) emitted under `failEvent`.
   *
   * Returns the parsed JSON payload, or `undefined` to signal failure —
   * distinct from a parsed `null` body so callers can tell "request
   * failed" from "body was literally null". Callers keep their own
   * success logging and payload shaping; the throttle (`acquireSlot`)
   * stays with the caller so a slot is reserved per logical request.
   *
   * `accept-language: en` asks Nominatim for canonical English
   * display_names, reducing locale drift on the normalized cache keys
   * the render path looks rows up by.
   */
  private async fetchJson(
    url: string,
    queryHash: string,
    failEvent: string,
  ): Promise<unknown | undefined> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.requestTimeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          'user-agent': this.userAgent,
          accept: 'application/json',
          'accept-language': 'en',
        },
        signal: abort.signal,
      });
    } catch {
      // AbortError and any other transport failure collapse into the
      // same log line — callers don't distinguish; the cache layer
      // applies the negative-hit TTL either way.
      log.warn({ queryHash, reason: 'network-error' }, failEvent);
      return undefined;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      log.warn({ queryHash, reason: `http-${res.status}` }, failEvent);
      return undefined;
    }

    try {
      return await res.json();
    } catch {
      log.warn({ queryHash, reason: 'invalid-json' }, failEvent);
      return undefined;
    }
  }

  private buildUrl(query: string): string {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '1',
      // Structured address parts so the hit carries a city for the
      // card line (#111) — never parsed out of display_name.
      addressdetails: '1',
    });
    return `${this.baseUrl}/search?${params.toString()}`;
  }

  private buildReverseUrl(lat: number, lng: number): string {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lng.toString(),
      format: 'jsonv2',
      addressdetails: '1',
      // zoom=18 ≈ building-level — matches the precision a 10-char
      // Plus Code resolves at, so the returned display_name names the
      // POI itself rather than the surrounding neighbourhood.
      zoom: '18',
    });
    return `${this.baseUrl}/reverse?${params.toString()}`;
  }

  private buildSearchUrl(query: string, limit: number): string {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: String(limit),
      // addressdetails gives us `address.country_code` for the empty-
      // country autofill; namedetails gives the short `name` for the
      // picker's primary line.
      addressdetails: '1',
      namedetails: '1',
    });
    return `${this.baseUrl}/search?${params.toString()}`;
  }
}

function clampSearchLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_SEARCH_LIMIT;
  const floored = Math.floor(requested);
  if (floored < 1) return 1;
  if (floored > MAX_SEARCH_LIMIT) return MAX_SEARCH_LIMIT;
  return floored;
}

/**
 * Map one Nominatim rich hit to a {@link GeocodeCandidate}, or `null` if
 * the hit lacks usable coordinates (a candidate the user can't pin is
 * worse than no candidate). Name falls back to the first comma-part of
 * `display_name`; country_code is uppercased; type/class default to
 * null when absent.
 */
function parseCandidate(raw: unknown): GeocodeCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const hit = raw as NominatimRichHit;

  const lat = parseCoord(hit.lat);
  const lng = parseCoord(hit.lon);
  if (lat === null || lng === null) return null;

  const displayName = typeof hit.display_name === 'string' ? hit.display_name : null;
  if (displayName === null || displayName === '') return null;

  const name = pickName(hit, displayName);
  const osmType = typeof hit.type === 'string' && hit.type !== '' ? hit.type : null;
  const category = typeof hit.class === 'string' && hit.class !== '' ? hit.class : null;
  const countryCode = pickCountryCode(hit);

  return {
    lat,
    lng,
    displayName,
    name,
    addressLabel: displayName,
    osmType,
    category,
    countryCode,
  };
}

// Prefer the structured `namedetails.name`, then a top-level `name`,
// then the first comma-delimited part of `display_name` ("Park Hyatt
// Tokyo, 3-7-1-2 …" → "Park Hyatt Tokyo"). Always non-empty: the caller
// guarantees a non-empty `display_name`, so the final fallback can't be
// blank.
function pickName(hit: NominatimRichHit, displayName: string): string {
  const fromDetails = hit.namedetails?.name;
  if (typeof fromDetails === 'string' && fromDetails.trim() !== '') return fromDetails.trim();
  if (typeof hit.name === 'string' && hit.name.trim() !== '') return hit.name.trim();
  const firstPart = displayName.split(',')[0]?.trim();
  return firstPart && firstPart !== '' ? firstPart : displayName;
}

// ISO 3166-1 alpha-2 from `address.country_code`, uppercased. Nominatim
// emits it lowercase; we store/compare uppercase everywhere else. `null`
// when absent or not a 2-letter code.
function pickCountryCode(hit: NominatimRichHit): string | null {
  const cc = hit.address?.country_code;
  if (typeof cc !== 'string') return null;
  const trimmed = cc.trim();
  if (trimmed.length !== 2) return null;
  return trimmed.toUpperCase();
}

// Coarse locality from Nominatim's structured address, most-specific
// first. Municipality/county/state are the long tail for places that
// sit outside any city boundary — a coarse-but-true locality beats
// null on the card line (#111).
function pickCity(address: Record<string, unknown> | null | undefined): string | null {
  if (!address) return null;
  for (const key of ['city', 'town', 'village', 'municipality', 'county', 'state']) {
    const v = address[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCoord(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    // Guard empty/whitespace strings: `Number('')` is 0 (finite), which
    // would otherwise pass as a phantom coordinate at the equator /
    // prime meridian instead of being rejected as a malformed hit.
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
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
