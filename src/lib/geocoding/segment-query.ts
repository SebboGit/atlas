// Per-type geocode query construction for a segment row. Lives here
// (not in segments/) so the geocoding module owns the contract for
// "what string do I send to the geocoder" — keeping the lifecycle hook
// and the trip-map repo using the *same* derivation rules, which in
// turn means the cache hits when the read path looks up what the
// write path put in.
//
// Per CLAUDE.md "External Integrations" — `locationName` is a short
// pin-style label like "Shibuya" or "Bukit Bintang" (the user's
// shorthand for where on a map this lands). The geocodable strings
// are the per-type fields, with `plusCode` taking precedence
// universally when present:
//
//   hotel    → plusCode → propertyName (+ context) → address
//   activity → plusCode → address → title (+ context)
//   transit  → plusCode → address → toName → fromName
//   food     → plusCode → venue (+ context) → address
//
// **Why plusCode wins.** Plus Codes resolve to coordinates offline
// (full codes) or with a single anchor lookup (local codes) and
// effectively never null. They sidestep free-text search entirely —
// see [[geocoding-failure-modes]] for the patterns they bypass, and
// [[plus-code-architecture]] for the design.
//
// **Hotel/food are name-first as of ADR-0018.** The free-text path is
// now a Photon → Nominatim ladder, and Photon's search-engine matching
// makes venue-name queries the reliable option — the address-first
// order only ever existed to dodge Nominatim's left-to-right q-parser
// choking on brand-y names. "Context" is the user's pin-style
// locationName when present, else the segment's country name: enough
// to kill wrong-city matches for chains without dragging in the full
// address (whose building/floor detail is what used to null out).
// The address remains the query for name-less segments.
//
// Notes and flights produce no query — flights are handled by the
// committed IATA airport snapshot, notes have no place on a map.
//
// **Normalization lives here too (ADR-0018 review finding).** The
// returned string is geocoder-ready: address branches run through the
// address-noise stripper (`normalizeForGeocoder`), while name and
// Plus Code branches get NFC/whitespace cleanup ONLY — the stripper's
// floor/unit/postcode rules were written for addresses and silently
// delete tokens from number-branded venue names ("Room 39, Bangkok" →
// "Bangkok"; "Hotel 1898, Spain" → "Hotel, Spain"). Call sites MUST
// NOT re-apply normalizeForGeocoder on top of this output.

import { countryName } from '@/lib/countries';
import {
  activityDataSchema,
  foodDataSchema,
  hotelDataSchema,
  transitDataSchema,
  type SegmentType,
} from '@/lib/segments';

import { normalizeForGeocoder } from './normalize-for-geocoder';

// The cleanup half of `normalizeForGeocoder` without the address-noise
// stripping — for strings whose tokens are the search target itself.
function cleanNameQuery(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Minimal shape required to derive a geocode query. Both `Segment` and
 * `WishlistItem` satisfy this — and that's the whole point: wishlist
 * items and the segments materialised from them must produce the same
 * query string so they share the same `geocode_cache` row. A wishlist
 * item geocoded on save means its materialised segment is born with
 * coordinates ready for the trip map.
 */
export interface PlaceLike {
  type: SegmentType | 'food' | 'activity';
  data: unknown;
  locationName: string | null;
  /**
   * ISO 3166-1 alpha-2 of the place's country. Both `Segment` and
   * `WishlistItem` carry it, so the shared-cache invariant holds: a
   * wishlist item and its materialised segment still derive the same
   * query string. Used as the disambiguation tail for name queries
   * when no `locationName` is set.
   */
  countryCode: string | null;
}

// "Park Hyatt Tokyo, Shibuya" when a pin label exists, else
// "Park Hyatt Tokyo, Japan" from the segment's country, else the bare
// name. The tail exists to kill wrong-city matches for names that
// occur in many places; country comes free on the row and is spelled
// out (not the ISO code) because geocoders index names, not codes.
function withPlaceContext(name: string, place: PlaceLike): string {
  const loc = place.locationName?.trim();
  if (loc) return cleanNameQuery(`${name}, ${loc}`);
  const cc = place.countryCode?.trim();
  if (cc) {
    // Only append a tail that actually resolved — countryName echoes
    // unknown codes back, and "Sushi Zen, JA" is a junk token that
    // costs matches the bare name would have made.
    const country = countryName(cc);
    if (country.toUpperCase() !== cc.toUpperCase()) {
      return cleanNameQuery(`${name}, ${country}`);
    }
  }
  return cleanNameQuery(name);
}

/**
 * Build the free-text geocoder query for a place (segment or wishlist
 * item), or null if it has no geocodable identity (wrong type, missing
 * required fields, malformed `data` JSONB). The string returned here
 * is what `Geocoder.geocode` sees, already geocoder-normalized (see
 * the header comment — do NOT re-apply normalizeForGeocoder); the
 * cache layer lowercases it on the way in. A Plus Code returned here
 * is routed by the PlaceResolver to the offline-decode pipeline;
 * everything else goes to the Photon → Nominatim ladder.
 */
export function buildGeocodeQuery(segment: PlaceLike): string | null {
  switch (segment.type) {
    case 'hotel': {
      const parsed = hotelDataSchema.safeParse(segment.data);
      if (!parsed.success) return null;
      const plus = parsed.data.plusCode?.trim();
      if (plus) return cleanNameQuery(plus);
      const name = parsed.data.propertyName?.trim();
      if (name) return withPlaceContext(name, segment);
      // No property name on file — the address is all we have. Its
      // failure modes (building/floor tails) are what the name-first
      // order avoids, but a name-less segment has no better option.
      const address = parsed.data.address?.trim();
      return address ? normalizeForGeocoder(address) || null : null;
    }

    case 'activity': {
      const parsed = activityDataSchema.safeParse(segment.data);
      if (!parsed.success) return null;
      const plus = parsed.data.plusCode?.trim();
      if (plus) return cleanNameQuery(plus);
      const address = parsed.data.address?.trim();
      if (address) return normalizeForGeocoder(address) || null;
      // locationName (the user's pin-style label, "Shibuya") — else
      // the country name — disambiguates landmarks that exist in
      // multiple places ("Old Town" appears in roughly every city
      // ever built).
      return withPlaceContext(parsed.data.title, segment);
    }

    case 'transit': {
      const parsed = transitDataSchema.safeParse(segment.data);
      if (!parsed.success) return null;
      const plus = parsed.data.plusCode?.trim();
      if (plus) return cleanNameQuery(plus);
      const address = parsed.data.address?.trim();
      if (address) return normalizeForGeocoder(address) || null;
      // Destination-as-pin matches the flight convention (ADR-0005's
      // "primary country = destination"). Fall back to origin only
      // when we genuinely have no destination — better one pin at
      // the start of the journey than no pin at all. Station names
      // are search targets, not addresses: name cleanup only.
      const dest = parsed.data.toName?.trim();
      if (dest) return cleanNameQuery(dest);
      const origin = parsed.data.fromName?.trim();
      return origin ? cleanNameQuery(origin) : null;
    }

    case 'food': {
      const parsed = foodDataSchema.safeParse(segment.data);
      if (!parsed.success) return null;
      const plus = parsed.data.plusCode?.trim();
      if (plus) return cleanNameQuery(plus);
      // Name-first, same as hotels (ADR-0018). The context tail keeps
      // "Ippudo" from resolving to whichever branch ranks first
      // worldwide.
      const name = parsed.data.venue?.trim();
      if (name) return withPlaceContext(name, segment);
      const address = parsed.data.address?.trim();
      return address ? normalizeForGeocoder(address) || null : null;
    }

    // Flights are placed via the IATA airport snapshot — not a
    // free-text geocode. Notes have no place on the map.
    case 'flight':
    case 'note':
      return null;
  }
}
