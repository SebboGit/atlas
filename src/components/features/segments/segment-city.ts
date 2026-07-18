// City line for segment cards (#111): the coarse locality resolved by
// the geocoder (carried on the cached coords), shown so a cryptically
// named hotel still says where it is. Suppressed when the user's own
// locationName already covers it — "Shibuya" next to "Shibuya" (or a
// label like "Shibuya, Tokyo" that contains the city) is noise, not
// information.
export function segmentCity(
  coords: { city?: string | null } | null | undefined,
  locationName: string | null,
): string | null {
  const city = coords?.city?.trim();
  if (!city) return null;
  const label = locationName?.trim().toLowerCase();
  if (label) {
    const c = city.toLowerCase();
    if (label === c || label.includes(c) || c.includes(label)) return null;
  }
  return city;
}
