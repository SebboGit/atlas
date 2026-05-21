// Great-circle geometry helpers for the stats dashboard.
//
// Kept dependency-free and pure so the distance maths is unit-testable
// in isolation — no DB, no React. The repo layer feeds it airport
// coordinates from the committed `src/lib/airports` snapshot.

/** WGS84 point. Latitude and longitude in decimal degrees. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

// Mean Earth radius (IUGG). Kilometres — the unit the dashboard reports.
const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle (haversine) distance between two WGS84 points, in
 * kilometres. This is the straight-line "as the crow flies" distance
 * along Earth's surface — not the actual flight track, which is longer
 * because of routing and altitude. Honest enough for a lifetime
 * "distance flown" headline; we're not selling air miles.
 *
 * Returns 0 for identical points (a same-airport round trip leg, or a
 * data-entry quirk) rather than a floating-point near-zero.
 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  if (a.lat === b.lat && a.lng === b.lng) return 0;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
