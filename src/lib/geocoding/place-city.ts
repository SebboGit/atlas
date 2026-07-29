// City line for place cards (#111): the coarse locality resolved by
// the geocoder (carried on the cached coords), shown so a cryptically
// named hotel — or a wishlist item saved with nothing but a Plus Code —
// still says where it is.
//
// Pure and React-free so every surface shares one suppression rule:
// segment cards on the itinerary tabs, wishlist cards on /wishlist, and
// the wishlist suggestion rows on a trip's Food / Activities tabs. Lives
// under lib/geocoding rather than the segments component folder because
// it stopped being a segment concern; client code imports this leaf
// directly, never the barrel (which pulls the cache and `pg`).
//
// The value is not always a city: `chooseLocality` falls through to
// district / county / state, so a province ("Ninh Bình") is a legitimate
// result. Render it bare — never label the line "City".
export function placeCity(
  coords: { city?: string | null } | null | undefined,
  locationName: string | null,
  /**
   * Other text rendered on the same card, so the city doesn't repeat
   * something the user can already read. Each field gets the rule its
   * failure mode deserves — see the comments below.
   */
  alongside?: {
    /**
     * Country name shown on the same row. Compared by EQUALITY only,
     * never containment: city-states legitimately resolve city ===
     * country (Singapore, Hong Kong, Monaco, Macau, Vatican City), but
     * "Mexico City", "Guatemala City", "Panama City" and "Kuwait City"
     * all contain their country's name and are worth printing.
     */
    country?: string | null;
    /**
     * Free text already on the card — an address, a description.
     * ONE-WAY only: suppress when that text contains the city, never
     * the reverse. A three-character description would otherwise
     * delete "Kyoto" for being a superstring of it.
     */
    text?: string | null;
  },
): string | null {
  const city = coords?.city?.trim();
  if (!city) return null;
  const c = city.toLowerCase();

  // Two-way against the user's own label: "Shibuya" next to "Shibuya"
  // (or a label like "Shibuya, Tokyo" that contains the city) is noise,
  // not information — and so is the inverse, a "ho chi minh" label
  // against a "Ho Chi Minh City" locality.
  const label = locationName?.trim().toLowerCase();
  if (label && (label === c || label.includes(c) || c.includes(label))) return null;

  const country = alongside?.country?.trim().toLowerCase();
  if (country && country === c) return null;

  const text = alongside?.text?.trim().toLowerCase();
  if (text && text.includes(c)) return null;

  return city;
}
