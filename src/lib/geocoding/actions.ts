'use server';

import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { countryName } from '@/lib/countries';
import { log } from '@/lib/log';

import { getGeocoder } from './index';
import { normalizeForGeocoder, rejoinSplitDiacritics } from './normalize-for-geocoder';
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
  /**
   * The segment's typed/extracted address, used ONLY as the fallback
   * rung when the name search returns nothing (an unmapped property on
   * a mapped street still gets street-level candidates). Never part of
   * the primary name query — the locked design stands.
   */
  address: z
    .string()
    .max(600)
    .optional()
    .transform((s) => {
      const t = s?.trim();
      return t ? t : undefined;
    }),
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
  /**
   * `via` records which rung produced the candidates: 'name' is the
   * primary venue-name query; 'address' means the name found nothing
   * and these are matches for the segment's address instead — the UI
   * labels them so a street-level result isn't mistaken for the venue.
   */
  | { ok: true; candidates: GeocodeCandidate[]; via: 'name' | 'address' }
  | { ok: false; reason: 'invalid' | 'unconfigured' };

/**
 * Search for up to 3 place candidates for the interactive address
 * picker. Fires from a button, never as-you-type (public-endpoint
 * etiquette); at most THREE ladder rungs per click — name, full
 * address, truncated address — each a single `search()` that tries
 * Photon first and Nominatim only on a Photon empty, so the absolute
 * worst case is six throttled requests across the two providers.
 * The primary query is the venue NAME (+ optional locationName +
 * country name); the address rungs exist for properties OSM simply
 * doesn't have (ADR-0018's coverage gap).
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
  if (candidates.length > 0) return { ok: true, candidates, via: 'name' };

  // Fallback rung: the name found nothing — a property that simply
  // isn't in OSM (the coverage gap, ADR-0018). If an address is on
  // file, offer matches for THAT instead: an unmapped hotel on a
  // mapped street still yields a street-level pick, and picking a
  // candidate fills the Plus Code, which is exactly the stable
  // correction path. The address goes through the noise-stripper +
  // diacritic rejoin — extracted addresses arrive with PDF glyph
  // mangling ("Nguy ễ n C ả nh Chân") that otherwise poisons matching.
  if (parsed.data.address) {
    const addressQuery = normalizeForGeocoder(parsed.data.address);
    if (addressQuery !== '') {
      const viaAddress = await geocoder.search(addressQuery, { limit: 3 });
      if (viaAddress.length > 0) return { ok: true, candidates: viaAddress, via: 'address' };

      // Long extracted addresses (booking PDFs concatenate localized
      // duplicates — nine comma segments is a real observed case)
      // drown the scorers even after normalization. Retry with the
      // head (street + number) plus the last two segments (locality +
      // country) — the shape that reliably resolves to street-level
      // candidates. Only when truncation actually changes the query.
      const parts = addressQuery.split(', ');
      if (parts.length > 3) {
        const truncated = [parts[0], ...parts.slice(-2)].join(', ');
        const viaTruncated = await geocoder.search(truncated, { limit: 3 });
        return { ok: true, candidates: viaTruncated, via: 'address' };
      }
      return { ok: true, candidates: [], via: 'address' };
    }
  }

  return { ok: true, candidates: [], via: 'name' };
}

/**
 * Compose the venue-POI search query: "<name>, <locationName?>,
 * <countryName?>". The NAME leads; the locationName and resolved
 * country name are appended as disambiguating context the way the
 * user's own map shorthand would. The typed address is deliberately
 * absent — it's the OUTPUT the user picks, never the input.
 */
function composeQuery(input: z.output<typeof placeSearchInput>): string {
  // The name may be a PDF-extracted field carrying glyph-split
  // diacritics ("Nguy ễ n") — repair it so the name rung can match.
  const parts: string[] = [rejoinSplitDiacritics(input.name.normalize('NFC'))];
  if (input.locationName && input.locationName !== '') parts.push(input.locationName);
  if (input.countryCode) {
    // Resolve ISO → English name. `countryName` returns the code itself
    // for an unrecognised value, which is still a usable token.
    parts.push(countryName(input.countryCode));
  }
  return parts.join(', ');
}
