'use server';

import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { countryName } from '@/lib/countries';
import { log } from '@/lib/log';

import { getGeocoder } from './index';
import type { GeocodeCandidate } from './types';

// The four geocoded segment types the interactive picker serves. Notes
// have no place on a map; flights are pinned from the committed IATA
// airport snapshot, never free-text-searched. Kept inline (not the
// segment enum) so the picker's contract is exactly the set it handles.
const PICKER_TYPES = ['hotel', 'activity', 'transit', 'food'] as const;

// Input validated at the trust boundary. The `name` is the venue / POI
// NAME (propertyName / title / venue / toName) — never the typed
// address, which fails in much of Asia / informal areas (see the locked
// design + ADR-0010). `locationName` and `countryCode` narrow the query
// the way the user's own map shorthand would.
const placeSearchInput = z.object({
  type: z.enum(PICKER_TYPES),
  name: z.string().trim().min(1).max(200),
  locationName: z.string().trim().max(200).optional(),
  // ISO 3166-1 alpha-2. Accept any case; '' / absent → no country
  // context. We don't reject an unknown code here — `countryName`
  // passes an unrecognised code straight through, so a stale value
  // just adds a harmless token to the query.
  countryCode: z
    .union([z.string(), z.null()])
    .optional()
    .transform((s) => {
      if (s === null || s === undefined) return undefined;
      const t = s.trim();
      return t === '' ? undefined : t.toUpperCase();
    })
    .refine((s) => s === undefined || s.length === 2, 'Choose a valid country'),
});

export type PlaceSearchInput = z.input<typeof placeSearchInput>;

// Result kinds the picker UI switches on. Kept as a small tagged union
// so a transport failure ("error") reads differently from a clean "no
// matches" ("ok" with an empty list) — the UI copy differs.
export type PlaceSearchResult =
  | { ok: true; candidates: GeocodeCandidate[] }
  | { ok: false; reason: 'invalid' | 'unconfigured' };

/**
 * Search for up to 3 place candidates for the interactive address
 * picker. ONE Nominatim request per call (the public OSM usage policy
 * forbids as-you-type querying — this fires from a button). Composes a
 * venue-POI query from the NAME (+ optional locationName + country
 * name), NEVER from the typed address.
 *
 * Auth-gated and Zod-validated like every other mutation-adjacent
 * action. Never throws: an unconfigured geocoder (missing
 * NOMINATIM_CONTACT_EMAIL) or any provider failure collapses to a typed
 * result so the form's manual-entry path always survives.
 */
export async function searchPlaceCandidatesAction(raw: unknown): Promise<PlaceSearchResult> {
  await requireUser();

  const parsed = placeSearchInput.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'invalid' };

  const query = composeQuery(parsed.data);

  let geocoder;
  try {
    geocoder = getGeocoder();
  } catch (error) {
    // The expected failure is a missing NOMINATIM_CONTACT_EMAIL (the
    // factory throws on it). Anything else is an unexpected defect — log
    // it rather than silently mislabel it as "unconfigured", but still
    // degrade to the typed result either way: this action is awaited
    // inside a client transition and must never throw, and "search
    // unavailable" keeps manual address / Plus Code entry working.
    const expected = error instanceof Error && error.message.includes('NOMINATIM_CONTACT_EMAIL');
    if (!expected) {
      log.error(
        { reason: error instanceof Error ? error.message : 'unknown' },
        'geocoding.search.geocoder_unavailable',
      );
    }
    return { ok: false, reason: 'unconfigured' };
  }

  // `search` is no-throw by contract; [] covers down / rate-limited /
  // no-match alike. The UI distinguishes loading vs empty itself.
  const candidates = await geocoder.search(query, { limit: 3 });
  return { ok: true, candidates };
}

/**
 * Compose the venue-POI search query: "<name>, <locationName?>,
 * <countryName?>". The NAME leads; the locationName and resolved
 * country name are appended as disambiguating context the way the
 * user's own map shorthand would. The typed address is deliberately
 * absent — it's the OUTPUT the user picks, never the input.
 */
function composeQuery(input: z.output<typeof placeSearchInput>): string {
  const parts: string[] = [input.name];
  if (input.locationName && input.locationName !== '') parts.push(input.locationName);
  if (input.countryCode) {
    // Resolve ISO → English name. `countryName` returns the code itself
    // for an unrecognised value, which is still a usable token.
    parts.push(countryName(input.countryCode));
  }
  return parts.join(', ');
}
