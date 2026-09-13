// Station-aware lookups for transit endpoints (ADR-0019). Pure: the key
// grammar, per-mode suffix stripping, category filters, the rung order
// and the name-agreement guard. PlaceResolver runs the ladder; this file
// only decides what it asks for and which answers it accepts.
//
// Why a key grammar at all: the pin geocoder is `Geocoder.geocode(query)`
// and the background job payload is just `{ query }`, so a category hint
// can only reach it by riding inside the query string — the same way a
// Plus Code does. The key doubles as the `geocode_cache` row key.
//
//   station:<mode>:<cc|->:<name>      e.g. station:train:jp:Kyoto Station
//
// The name is the RAW cleaned name as typed. Stripping "Station" happens
// at resolve time, so tuning the strip rules never re-keys the cache.

import {
  hasTransitEndpoints,
  TRANSIT_ENDPOINT_MODES,
  type TransitEndpointMode,
} from '@/lib/segments/transit-endpoints';

import type { OsmTag, StationQuery } from './types';

// `[\s\S]` rather than `.` so a name can never fail to parse on a line
// break that the cache key's whitespace collapse would still accept.
const STATION_KEY = new RegExp(
  `^station:(${TRANSIT_ENDPOINT_MODES.join('|')}):([a-z]{2}|-):([\\s\\S]+)$`,
  'i',
);

// Same whitespace collapse `normalizeQuery` applies to the cache key, so
// the key a caller builds and the row it lands on always parse alike.
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function encodeStationQuery(q: StationQuery): string {
  const cc = q.countryCode?.trim() ?? '';
  const ccPart = /^[a-z]{2}$/i.test(cc) ? cc.toLowerCase() : '-';
  return `station:${q.mode}:${ccPart}:${collapseWhitespace(q.name)}`;
}

/**
 * Parse a station key. Case-insensitive because the cache key is the
 * lowercased form while the job payload keeps the original case. A Plus
 * Code can never match: none of "station" is in the OLC alphabet.
 */
export function tryParseStationQuery(input: string): StationQuery | null {
  const match = STATION_KEY.exec(input.trim());
  if (!match) return null;
  const mode = match[1]!.toLowerCase();
  const name = collapseWhitespace(match[3]!);
  if (!hasTransitEndpoints(mode) || name === '') return null;
  const cc = match[2]!.toLowerCase();
  return { mode, countryCode: cc === '-' ? null : cc, name };
}

// One trailing category word per mode. OSM names stations after the
// place ("東京" / name:en "Tokyo"), so "Tokyo Station" searched verbatim
// with a station filter matches the wrong station — the probes behind
// ADR-0019. Japanese / Chinese / Korean station suffixes attach without
// a space.
const SUFFIX_BY_MODE: Record<TransitEndpointMode, RegExp> = {
  train: /(?:\s+(?:(?:rail|railway|train)\s+)?(?:station|stn\.?|sta\.?)|駅|站|역)$/iu,
  bus: /(?:\s+(?:station|stn\.?|sta\.?)|駅|站|역)$/iu,
  ferry: /(?:\s+(?:ferry\s+)?(?:terminal|port|pier|station|stn\.?|sta\.?)|港|駅|站|역)$/iu,
};

// Operator prefixes that aren't part of the station's OSM name. "JR Kyoto
// Station" otherwise matches JR Fujinomori and JR Inari, never Kyoto.
const PREFIX_BY_MODE: Partial<Record<TransitEndpointMode, RegExp>> = {
  train: /^JR[\s-]+/i,
};

/**
 * Strip one trailing station word (and, for trains, a leading operator
 * prefix). Never returns an empty string.
 */
export function stripStationName(name: string, mode: TransitEndpointMode): string {
  const trimmed = name.trim();
  const prefix = PREFIX_BY_MODE[mode];
  const stripped = (prefix ? trimmed.replace(prefix, '') : trimmed)
    .replace(SUFFIX_BY_MODE[mode], '')
    .trim();
  return stripped === '' ? trimmed : stripped;
}

// OR-sets of OSM main tags per mode. Stations are tagged inconsistently
// (Berlin Hbf's top hit is a `building=train_station`), hence the spread.
// Initial values — tuning them doesn't need a new ADR.
export const STATION_OSM_TAGS: Readonly<Record<TransitEndpointMode, ReadonlyArray<OsmTag>>> = {
  train: [
    { key: 'railway', value: 'station' },
    { key: 'railway', value: 'halt' },
    { key: 'railway', value: 'stop' },
    { key: 'building', value: 'train_station' },
    { key: 'public_transport', value: 'station' },
  ],
  bus: [
    { key: 'amenity', value: 'bus_station' },
    { key: 'highway', value: 'bus_stop' },
    { key: 'public_transport', value: 'station' },
  ],
  ferry: [{ key: 'amenity', value: 'ferry_terminal' }],
};

export interface StationRung {
  query: string;
  countryCode: string | null;
}

/**
 * The tagged Photon lookups to try, in order. The raw name goes first
 * whenever stripping changes it: a generic stripped name ("Union" from
 * "Union Station") matches the wrong station, while the name guard
 * already rejects the raw-name misses that stripping exists to fix
 * ("Tokyo Station" → Shakujii-kōen). A country-free rung comes last so a
 * cross-border origin — which carries the destination's country — can
 * still resolve.
 */
export function stationRungs(q: StationQuery): StationRung[] {
  const raw = q.name.trim();
  const stripped = stripStationName(raw, q.mode);
  const candidates: StationRung[] = q.countryCode
    ? [
        { query: raw, countryCode: q.countryCode },
        { query: stripped, countryCode: q.countryCode },
        { query: stripped, countryCode: null },
      ]
    : [
        { query: raw, countryCode: null },
        { query: stripped, countryCode: null },
      ];
  const seen = new Set<string>();
  return candidates.filter((rung) => {
    const key = `${rung.query.toLowerCase()}|${rung.countryCode ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Category words that say what a place is, not which one. Dropped from
// both sides of the guard so "Kyoto Station" agrees with "Kyoto" and with
// "Kyoto Station Building".
const GENERIC_TOKENS = new Set([
  'station',
  'stn',
  'sta',
  'hbf',
  'bhf',
  'bf',
  'hauptbahnhof',
  'bahnhof',
  'railway',
  'rail',
  'train',
  'bus',
  'coach',
  'ferry',
  'terminal',
  'pier',
  'port',
  'stop',
  'gare',
  'jr',
  'building',
]);

// Letters NFKD leaves whole, folded so "Łódź" compares as "lodz".
const LETTER_FOLDS: Record<string, string> = {
  ł: 'l',
  ø: 'o',
  đ: 'd',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ı: 'i',
};

// The Latin-script, non-generic words of a name. Other scripts are left
// out: Photon answers in English, so "東京" can't be compared against
// "Tōkyō" word by word.
function distinctiveTokens(s: string): Set<string> {
  const words = s
    .toLowerCase()
    .replace(/[łøđßæœı]/g, (c) => LETTER_FOLDS[c]!)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (t) => (t.length >= 2 || /\d/.test(t)) && /^[a-z0-9]+$/.test(t) && !GENERIC_TOKENS.has(t),
    );
  return new Set(words);
}

/**
 * Does a tagged hit name exactly the station that was asked for? Its
 * distinctive words must equal the query's — containing them isn't
 * enough. A category filter happily returns the nearest bus stop with any
 * name ("Busta Shinjuku" → "Shinjuku-3chome"), and a superset match is
 * just as wrong: "Yokohama Station" contains-matched Mutsu-Yokohama, 640
 * km away, and "Kobe Station" matched Kobe Airport. When no hit agrees
 * exactly, the raw-name fallback did as well or better in every probe.
 * A query with no comparable words (non-Latin script, or only generic
 * words) skips the check.
 */
export function stationNameMatches(queryName: string, hitName: string | null): boolean {
  if (hitName === null || hitName.trim() === '') return false;
  const wanted = distinctiveTokens(queryName);
  if (wanted.size === 0) return true;
  const got = distinctiveTokens(hitName);
  return got.size === wanted.size && [...wanted].every((t) => got.has(t));
}
