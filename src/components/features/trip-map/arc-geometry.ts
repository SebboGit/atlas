import type { TripMapArc } from '@/lib/trip-map/repo';

// Quadratic-bezier curve points between two coordinates, offset
// perpendicular to the direction of travel. The offset is taken to
// the "right" of A→B (rotated 90° clockwise from the travel vector):
// a return flight B→A therefore curves to the opposite side because
// "right of B→A" is the mirror half-plane of "right of A→B". The two
// arcs fan into a lens shape instead of stacking on the same line.
//
// `CURVE_RATIO` is the control-point offset as a fraction of the
// great-circle-ish distance between endpoints. 0.15 reads as a clear
// arc at every scale without becoming loopy.
//
// `CURVE_SEGMENTS` is the line-string fidelity. 24 segments is well
// past the perceptible-smoothness threshold for the line widths we
// render at.
export const CURVE_RATIO = 0.15;
export const CURVE_SEGMENTS = 24;

// Returns one or more line strings whose longitudes are all in
// [-180, 180]. A bezier that crosses the antimeridian is split into
// multiple segments so it renders correctly under `renderWorldCopies:
// false` — without the split, the segment past ±180 is simply clipped.
export function curvedArcCoords(arc: TripMapArc): [number, number][][] {
  const x0 = arc.originLng;
  const y0 = arc.originLat;
  // Take the shorter way around the globe by shifting destLng into
  // `[originLng - 180, originLng + 180]`. Without this, an HND→LAX
  // arc (raw dx = -258) sweeps west across Europe instead of east
  // across the Pacific. The shift is reversed when we normalise the
  // output back into [-180, 180] in `splitAtAntimeridian`.
  let x2 = arc.destLng;
  if (x2 - x0 > 180) {
    x2 -= 360;
  } else if (x2 - x0 < -180) {
    x2 += 360;
  }
  const y2 = arc.destLat;
  const dx = x2 - x0;
  const dy = y2 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) {
    return splitAtAntimeridian([
      [x0, y0],
      [x2, y2],
    ]);
  }
  // Perpendicular (right of travel) = travel vector rotated -90°.
  const perpX = dy / dist;
  const perpY = -dx / dist;
  const offset = dist * CURVE_RATIO;
  const cx = (x0 + x2) / 2 + perpX * offset;
  const cy = (y0 + y2) / 2 + perpY * offset;
  const points: [number, number][] = [];
  for (let i = 0; i <= CURVE_SEGMENTS; i += 1) {
    const t = i / CURVE_SEGMENTS;
    const it = 1 - t;
    const x = it * it * x0 + 2 * it * t * cx + t * t * x2;
    const y = it * it * y0 + 2 * it * t * cy + t * t * y2;
    points.push([x, y]);
  }
  return splitAtAntimeridian(points);
}

// Walks a polyline whose longitudes may extend past ±180 and splits
// it at antimeridian crossings, normalising each piece into
// [-180, 180]. Latitude at the crossing is linearly interpolated
// between the two flanking sample points — fine at our 24-segment
// fidelity. Real flight arcs only cross at most once; the loop
// handles repeats safely anyway.
export function splitAtAntimeridian(points: [number, number][]): [number, number][][] {
  if (points.length === 0) return [];
  const worldOf = (lng: number) => Math.floor((lng + 180) / 360);
  const normalize = (lng: number) => lng - worldOf(lng) * 360;
  const lines: [number, number][][] = [];
  let current: [number, number][] = [[normalize(points[0]![0]), points[0]![1]]];
  for (let i = 1; i < points.length; i += 1) {
    const [pLng, pLat] = points[i - 1]!;
    const [lng, lat] = points[i]!;
    const pIdx = worldOf(pLng);
    const cIdx = worldOf(lng);
    if (pIdx === cIdx) {
      current.push([normalize(lng), lat]);
      continue;
    }
    const east = cIdx > pIdx;
    const boundaryExtended = (east ? pIdx + 1 : pIdx) * 360 - 180;
    const t = (boundaryExtended - pLng) / (lng - pLng);
    const latAtBoundary = pLat + t * (lat - pLat);
    const exit = east ? 180 : -180;
    const entry = east ? -180 : 180;
    current.push([exit, latAtBoundary]);
    lines.push(current);
    current = [
      [entry, latAtBoundary],
      [normalize(lng), lat],
    ];
  }
  lines.push(current);
  return lines;
}
