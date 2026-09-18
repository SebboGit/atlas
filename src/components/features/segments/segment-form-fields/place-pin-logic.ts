// Pure rules behind the "where does this place sit on the map" line that
// every pinned segment form shows — the transit From / To blocks
// (ADR-0019) and the hotel, food and activity forms. Kept out of the
// components so they're tested without a DOM.
//
// The rule they encode: a Plus Code derived from the saved segment's
// cached coordinates is shown, never written into the form. A derived
// code that got persisted would outrank the venue name in
// `buildGeocodeQuery`, so a later rename or address fix could no longer
// move the pin (#135).

// Leaf imports (not the geocoding barrel) so the form never pulls the
// cache / pg driver into the browser bundle. `segment-query` is the
// production query builder — the same derivation the lifecycle hook and
// the trip-map repo run — and is itself leaf: zod, the country snapshot
// and the Plus Code codec, no DB.
import { normalizeQuery } from '@/lib/geocoding/normalize';
import { encodePlusCode, isValidPlusCodeShape } from '@/lib/geocoding/plus-code';
import {
  buildGeocodeQuery,
  buildTransitEndpointQueries,
  type PlaceLike,
} from '@/lib/geocoding/segment-query';

/** The three form fields that locate one place. */
export interface PlacePaths {
  name: string;
  address: string;
  plusCode: string;
}

/**
 * The single place each one-place segment type carries. Transit is not
 * here: its two ends live in `TRANSIT_ENDPOINT_PATHS` (ADR-0019).
 */
export const PLACE_PATHS = {
  hotel: { name: 'data.propertyName', address: 'data.address', plusCode: 'data.plusCode' },
  activity: { name: 'data.title', address: 'data.address', plusCode: 'data.plusCode' },
  food: { name: 'data.venue', address: 'data.address', plusCode: 'data.plusCode' },
} as const satisfies Record<string, PlacePaths>;

/** Trimmed string form of an unknown field value; '' for anything else. */
export function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Value at a dotted form path (`data.fromName`) in a values object. */
export function valueAt(values: unknown, path: string): unknown {
  let current: unknown = values;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** The three locating values read off one values object at once. */
export function placeValuesAt(values: unknown, paths: PlacePaths): PlaceValues {
  return {
    name: valueAt(values, paths.name),
    address: valueAt(values, paths.address),
    plusCode: valueAt(values, paths.plusCode),
  };
}

export interface PlaceValues {
  name: unknown;
  address: unknown;
  plusCode: unknown;
}

/**
 * Which query a set of form values is being asked about: the one place a
 * hotel, food or activity row has, or one end of a train, bus or ferry
 * leg (ADR-0019).
 */
export type PlaceTarget = 'place' | 'origin' | 'destination';

/** Form values in the shape the query builder reads. */
function toPlaceLike(values: unknown): PlaceLike | null {
  if (values === null || typeof values !== 'object') return null;
  const v = values as Record<string, unknown>;
  if (typeof v.type !== 'string') return null;
  return {
    type: v.type as PlaceLike['type'],
    data: v.data,
    locationName: typeof v.locationName === 'string' ? v.locationName : null,
    countryCode: typeof v.countryCode === 'string' ? v.countryCode : null,
  };
}

/**
 * The geocode cache key a set of form values would produce, or null when
 * they name nothing the geocoder could resolve. Built by the production
 * `buildGeocodeQuery`, so the rules stay in one place: a Plus Code
 * outranks the name, hotels and food are name-first with a locationName-
 * else-country tail (ADR-0018), and a station key carries the segment's
 * ISO country code and never its locationName (ADR-0019).
 */
export function placeQueryKey(values: unknown, target: PlaceTarget): string | null {
  const place = toPlaceLike(values);
  if (!place) return null;
  const query = queryFor(place, target);
  return query === null ? null : normalizeQuery(query);
}

function queryFor(place: PlaceLike, target: PlaceTarget): string | null {
  if (target === 'place') return buildGeocodeQuery(place);
  const ends = buildTransitEndpointQueries(place);
  if (ends) return target === 'origin' ? ends.origin : ends.destination;
  // Car / other: one query, and it locates the destination.
  return target === 'origin' ? null : buildGeocodeQuery(place);
}

/**
 * Whether the saved segment's geocode still describes what the form
 * holds — i.e. saving now would resolve to the same cache row.
 *
 * The test is query equality, not field equality: a hotel renamed or
 * moved to another locationName geocodes somewhere else even though its
 * address is untouched, while an address edit under a stable name
 * changes nothing (the address is informational once a name is on file,
 * ADR-0018). False for values that name nothing resolvable at all.
 */
export function placeStillLocated(current: unknown, saved: unknown, target: PlaceTarget): boolean {
  const key = placeQueryKey(current, target);
  return key !== null && key === placeQueryKey(saved, target);
}

export type PlacePinLine =
  | { state: 'pinned'; code: string; detail: string | null }
  | { state: 'located'; code: string; detail: string | null };

/**
 * The line saying where a place sits on the map:
 *   - `pinned` — a saved or typed Plus Code the form will accept, with the
 *     address as detail;
 *   - `located` — no code, but the saved segment's geocode placed it.
 *     Shown only while `stillLocated` holds, since values that would
 *     geocode somewhere else no longer point at that spot. Display-only:
 *     the code is never written into the form, so it can't freeze the pin.
 */
export function placePinLine(args: {
  plusCode: unknown;
  address: unknown;
  located: { lat: number; lng: number; city?: string | null } | null | undefined;
  /** From {@link placeStillLocated}. */
  stillLocated: boolean;
}): PlacePinLine | null {
  const code = trimText(args.plusCode);
  if (code !== '' && isValidPlusCodeShape(code)) {
    return { state: 'pinned', code, detail: trimText(args.address) || null };
  }
  // The encoder answers for a NaN latitude rather than throwing, so the
  // finite check is the one that keeps junk off the line.
  if (args.located && args.stillLocated && isFinitePoint(args.located)) {
    const encoded = encodePlusCode(args.located.lat, args.located.lng);
    if (encoded !== null) {
      return { state: 'located', code: encoded, detail: args.located.city ?? null };
    }
  }
  return null;
}

function isFinitePoint(point: { lat: number; lng: number }): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng);
}
