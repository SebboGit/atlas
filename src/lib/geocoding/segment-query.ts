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
// are the per-type fields:
//
//   hotel    → address (fallback: propertyName)
//   activity → title (+ locationName)
//   transit  → toName, fallback fromName
//   food     → address (fallback: venue + locationName)
//
// **Hotel uses address-first, NOT a compound `name, address` query.**
// Nominatim's q parser tokenises left-to-right and brand-y hotel
// names with suffixes ("a long branded hotel name Managed By
// Another Brand") routinely turn an otherwise-resolvable query into a
// null result. The address alone ("<address line 1> Bintang, Kuala
// Lumpur 55100, Malaysia") resolves reliably. propertyName is for
// the card title; the geocode goes off the address. Manually-entered
// hotels with no address fall back to propertyName.
//
// Notes and flights produce no query — flights are handled by the
// committed IATA airport snapshot, notes have no place on a map.

import {
  activityDataSchema,
  foodDataSchema,
  hotelDataSchema,
  transitDataSchema,
  type Segment,
} from '@/lib/segments';

/**
 * Build the free-text geocoder query for a segment, or null if the
 * segment has no geocodable identity (wrong type, missing required
 * fields, malformed `data` JSONB). The string returned here is what
 * `Geocoder.geocode` sees; the cache layer normalises it on the way in.
 *
 * The construction joins parts with ", " — Nominatim handles compound
 * queries natively and reliably scores a (name, address) match higher
 * than either part alone.
 */
export function buildGeocodeQuery(segment: Segment): string | null {
  switch (segment.type) {
    case 'hotel': {
      const parsed = hotelDataSchema.safeParse(segment.data);
      if (!parsed.success) return null;
      const address = parsed.data.address?.trim();
      if (address) return address;
      // No address on file. Hotel names alone resolve sometimes
      // (well-indexed independent properties) and not others (any
      // chain or hyphenated brand). The user can upgrade the pin
      // by adding an address in the segment form.
      return parsed.data.propertyName;
    }

    case 'activity': {
      const parsed = activityDataSchema.safeParse(segment.data);
      if (!parsed.success) return null;
      const parts = [parsed.data.title];
      // locationName here is the user's pin-style label ("Shibuya").
      // Tacking it onto the title disambiguates landmarks that exist
      // in multiple places ("Old Town" appears in roughly every city
      // ever built).
      const loc = segment.locationName?.trim();
      if (loc) parts.push(loc);
      return parts.join(', ');
    }

    case 'transit': {
      const parsed = transitDataSchema.safeParse(segment.data);
      if (!parsed.success) return null;
      // Destination-as-pin matches the flight convention (ADR-0005's
      // "primary country = destination"). Fall back to origin only
      // when we genuinely have no destination — better one pin at
      // the start of the journey than no pin at all.
      const dest = parsed.data.toName?.trim();
      if (dest) return dest;
      const origin = parsed.data.fromName?.trim();
      return origin ?? null;
    }

    case 'food': {
      const parsed = foodDataSchema.safeParse(segment.data);
      if (!parsed.success) return null;
      // Address-first, same as hotels: a restaurant address resolves
      // far more reliably than a venue name, especially for chains or
      // brand-y names that throw off Nominatim's q-parser.
      const address = parsed.data.address?.trim();
      if (address) return address;
      // No address on file. Fall back to the venue name, narrowed by
      // the user's pin-style locationName ("Ginza") — same
      // disambiguation rule as activities, since a restaurant name
      // can exist in many cities ("Ippudo" has branches worldwide).
      const parts = [parsed.data.venue];
      const loc = segment.locationName?.trim();
      if (loc) parts.push(loc);
      return parts.join(', ');
    }

    // Flights are placed via the IATA airport snapshot — not a
    // free-text geocode. Notes have no place on the map.
    case 'flight':
    case 'note':
      return null;
  }
}
