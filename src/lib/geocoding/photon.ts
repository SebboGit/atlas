// Photon-backed implementation of Geocoder + GeocodeSearcher. See
// ADR-0018: Photon indexes the same OSM data as Nominatim but through
// a real search engine (typo tolerance, prefix matching, `name:*`
// language tags), which is what makes venue-name queries — "Park Hyatt
// Tokyo" typed off a booking confirmation — actually resolve. It runs
// FIRST in the free-text ladder; Nominatim stays as the fallback and
// the reverse geocoder (see `fallback.ts` and the ADR).
//
// Same operating contract as the Nominatim client:
// - Public endpoint by default; PHOTON_URL points at a self-hosted
//   instance with no code change.
// - In-process token bucket (fair-use etiquette — Photon publishes no
//   hard limit, we keep Nominatim's 1 req/s posture anyway).
// - Never throws. Network / HTTP / parse failures all return null/[].
// - Never logs the raw query or response body — hashed query only.

import { createHash } from 'node:crypto';

import { log } from '@/lib/log';

import { chooseLocality } from './locality';
import type {
  Geocoder,
  GeocodeCandidate,
  GeocodeResult,
  GeocodeSearcher,
  ReverseGeocoder,
} from './types';

const DEFAULT_BASE_URL = 'https://photon.komoot.io';
const DEFAULT_MIN_INTERVAL_MS = 1100;
const DEFAULT_SEARCH_LIMIT = 3;
const MAX_SEARCH_LIMIT = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface PhotonGeocoderOptions {
  /** Base URL of the Photon instance. Defaults to the public komoot endpoint. */
  baseUrl?: string;
  /** Full `User-Agent` value. Not required by Photon's policy, sent anyway. */
  userAgent: string;
  /** Minimum ms between outbound calls; tests inject 0. */
  minIntervalMs?: number;
  /** Per-request timeout in ms. */
  requestTimeoutMs?: number;
  /** Test seam — production uses global fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam — production uses Date.now. */
  now?: () => number;
  /** Test seam — production uses setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

// Photon returns GeoJSON. Every field is unknown until proven —
// the response is not a contract.
interface PhotonFeature {
  geometry?: { coordinates?: unknown } | null;
  properties?: {
    name?: unknown;
    housenumber?: unknown;
    street?: unknown;
    district?: unknown;
    city?: unknown;
    county?: unknown;
    state?: unknown;
    country?: unknown;
    countrycode?: unknown;
    /** OSM class, e.g. "tourism", "amenity". */
    osm_key?: unknown;
    /** OSM type, e.g. "hotel", "restaurant". */
    osm_value?: unknown;
  } | null;
}

export class PhotonGeocoder implements Geocoder, GeocodeSearcher, ReverseGeocoder {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  // Same synchronous-reservation token bucket as the Nominatim client:
  // concurrent callers bump `nextAvailableAt` before awaiting, so a
  // burst serialises FIFO without an explicit promise chain.
  private nextAvailableAt = 0;

  constructor(opts: PhotonGeocoderOptions) {
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
      this.buildUrl(trimmed, 1),
      queryHash,
      'geocoding.photon.failed',
    );
    if (payload === undefined) return null;

    const features = extractFeatures(payload);
    const top = features[0];
    const result = top ? featureToResult(top) : null;
    if (result === null) {
      log.info({ queryHash, found: false }, 'geocoding.photon.ok');
      return null;
    }

    log.info({ queryHash, found: true }, 'geocoding.photon.ok');
    return result;
  }

  /**
   * Multi-candidate search for the interactive picker. Photon is
   * built for exactly this (search-as-you-type with typo tolerance),
   * so unlike the Nominatim client there is no separate URL shape —
   * the same endpoint returns richer hits and we just ask for more.
   */
  async search(query: string, opts?: { limit?: number }): Promise<GeocodeCandidate[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const limit = clampSearchLimit(opts?.limit);

    await this.acquireSlot();

    const queryHash = shortHash(trimmed);
    const payload = await this.fetchJson(
      this.buildUrl(trimmed, limit),
      queryHash,
      'geocoding.photon.search_failed',
    );
    if (payload === undefined) return [];

    const candidates: GeocodeCandidate[] = [];
    for (const raw of extractFeatures(payload)) {
      const candidate = featureToCandidate(raw);
      if (candidate) candidates.push(candidate);
      if (candidates.length >= limit) break;
    }

    log.info({ queryHash, count: candidates.length }, 'geocoding.photon.search_ok');
    return candidates;
  }

  /**
   * Reverse lookup for the Plus Code path. Photon runs FIRST in the
   * reverse ladder (see index.ts): its localized layer names the
   * metropolis a traveller would ("Ho Chi Minh City" where raw OSM
   * says a sub-city), which is exactly what the card line wants.
   * Same throttle, no-throw, hashed-coords logging contract.
   */
  async reverse(
    lat: number,
    lng: number,
  ): Promise<{ displayName: string; city: string | null } | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    await this.acquireSlot();

    const queryHash = shortHash(`${lat.toFixed(6)},${lng.toFixed(6)}`);
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lng.toString(),
      lang: 'en',
    });
    const payload = await this.fetchJson(
      `${this.baseUrl}/reverse?${params.toString()}`,
      queryHash,
      'geocoding.photon.reverse_failed',
    );
    if (payload === undefined) return null;

    const top = extractFeatures(payload)[0];
    const result = top ? featureToResult(top) : null;
    if (result === null) {
      log.info({ queryHash, found: false }, 'geocoding.photon.reverse_ok');
      return null;
    }

    log.info({ queryHash, found: true }, 'geocoding.photon.reverse_ok');
    return { displayName: result.displayName, city: result.city ?? null };
  }

  private async acquireSlot(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = this.now();
    const startAt = Math.max(now, this.nextAvailableAt);
    this.nextAvailableAt = startAt + this.minIntervalMs;
    const wait = startAt - now;
    if (wait > 0) await this.sleep(wait);
  }

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
        },
        signal: abort.signal,
      });
    } catch {
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

  private buildUrl(query: string, limit: number): string {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      // English labels where OSM carries them — same reasoning as the
      // Nominatim client's accept-language: keeps displayName stable
      // for the normalized cache keys the render path looks rows up by.
      lang: 'en',
    });
    return `${this.baseUrl}/api/?${params.toString()}`;
  }
}

function clampSearchLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_SEARCH_LIMIT;
  const floored = Math.floor(requested);
  if (floored < 1) return 1;
  if (floored > MAX_SEARCH_LIMIT) return MAX_SEARCH_LIMIT;
  return floored;
}

function extractFeatures(payload: unknown): PhotonFeature[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  // Filter non-object entries here so the per-feature mappers can
  // optional-chain safely — a `null` in `features[]` must degrade to
  // a skipped hit, never a throw (the file's no-throw contract; the
  // Nominatim client guards the same way in parseCandidate).
  return features.filter((f): f is PhotonFeature => typeof f === 'object' && f !== null);
}

// GeoJSON coordinates are [lon, lat] — the classic transposition trap.
function featureCoords(feature: PhotonFeature): { lat: number; lng: number } | null {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = parseCoord(coords[0]);
  const lat = parseCoord(coords[1]);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Photon has no `display_name` — synthesise one from the structured
 * properties, name-first, so cache rows and pin tooltips read like
 * Nominatim's ("Park Hyatt Tokyo, Nishishinjuku, Shinjuku, Tokyo,
 * Japan"). Order: name, street (+ housenumber), district, city, state,
 * country. Consecutive duplicates collapse (Photon often repeats the
 * city as the district).
 */
function synthesizeDisplayName(p: NonNullable<PhotonFeature['properties']>): string | null {
  const street = str(p.street);
  const housenumber = str(p.housenumber);
  const streetLine = street ? (housenumber ? `${street} ${housenumber}` : street) : null;
  const parts = [
    str(p.name),
    streetLine,
    str(p.district),
    str(p.city),
    str(p.state),
    str(p.country),
  ]
    .filter((part): part is string => part !== null)
    .filter((part, i, arr) => i === 0 || part !== arr[i - 1]);
  return parts.length > 0 ? parts.join(', ') : null;
}

function featureToResult(feature: PhotonFeature): GeocodeResult | null {
  const coords = featureCoords(feature);
  const props = feature.properties ?? {};
  const displayName = synthesizeDisplayName(props);
  if (coords === null || displayName === null) return null;
  // City for the card line (#111): shared locality logic — the
  // traveller-level city, with ward-shaped values deferring to the
  // state (see locality.ts).
  const city = chooseLocality({
    city: str(props.city),
    district: str(props.district),
    county: str(props.county),
    state: str(props.state),
  });
  return { lat: coords.lat, lng: coords.lng, displayName, city, source: 'photon' };
}

function featureToCandidate(feature: PhotonFeature): GeocodeCandidate | null {
  const coords = featureCoords(feature);
  if (coords === null) return null;
  const props = feature.properties ?? {};
  const displayName = synthesizeDisplayName(props);
  if (displayName === null) return null;

  const name = str(props.name) ?? displayName.split(',')[0]!.trim();
  const cc = str(props.countrycode);

  return {
    lat: coords.lat,
    lng: coords.lng,
    displayName,
    name,
    addressLabel: displayName,
    osmType: str(props.osm_value),
    category: str(props.osm_key),
    countryCode: cc && cc.length === 2 ? cc.toUpperCase() : null,
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCoord(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
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
 * Build a PhotonGeocoder from environment variables. Reuses
 * NOMINATIM_CONTACT_EMAIL for the identifying User-Agent — Photon
 * doesn't require one, but unattributed requests to a public
 * fair-use endpoint are still bad manners (CLAUDE.md).
 *
 * Optional env:
 *   - PHOTON_URL — override the public endpoint (e.g. self-hosted).
 */
export function createPhotonGeocoder(): PhotonGeocoder {
  const contact = process.env.NOMINATIM_CONTACT_EMAIL;
  if (!contact || contact.trim() === '') {
    throw new Error(
      'NOMINATIM_CONTACT_EMAIL is not set — required for the geocoder User-Agent. See ADR-0010/0018.',
    );
  }
  const version = process.env.npm_package_version ?? '0.0.0-dev';
  const baseUrl = process.env.PHOTON_URL;

  return new PhotonGeocoder({
    userAgent: `Atlas/${version} (${contact.trim()})`,
    ...(baseUrl ? { baseUrl } : {}),
  });
}
