// Layout for the latitude record: a south-to-north line with the equator
// in the middle, a marker at each extreme and a label above each marker.
// Pure — the ticket renders the percentages this returns.

import { latitudeLabel } from './format';

export interface LatitudeExtreme {
  label: string;
  lat: number;
}

export interface LatitudeLabel {
  caption: string;
  value: string;
  place: string;
  /** Marker position along the line, 0 (south end) to 100 (north end). */
  pct: number;
  /**
   * Which edge of the label sits on its marker. The ticket lays both
   * labels out in one row with shrinkable spacers, so a label anchored
   * near the end, or close to the other label, is pushed inwards
   * instead of clipping or overlapping.
   */
  anchor: 'start' | 'end';
}

export interface LatitudeTick {
  lat: number;
  pct: number;
  label: string;
}

export interface LatitudeLayout {
  /** The scale runs from −bound to +bound degrees. */
  bound: number;
  /** Degrees between the two extremes, or null with only one point. */
  span: number | null;
  /** South first. One entry when only one point is known. */
  labels: LatitudeLabel[];
  /** The solid stretch between the markers, as percentages. */
  bar: { from: number; to: number } | null;
  /** Width before the first label and after the last, as percentages. */
  leadSpacer: number;
  trailSpacer: number;
  ticks: LatitudeTick[];
  description: string;
}

/** The scale's half-width when every point is within ±60°. */
export const DEFAULT_BOUND = 60;

/**
 * Half-width of the scale: ±60° by default, widened in 10° steps until
 * the furthest point fits, never past the poles. Symmetric, so the
 * equator always sits in the middle.
 */
export function latitudeBound(lats: number[]): number {
  const furthest = Math.max(0, ...lats.map((l) => Math.abs(l)));
  return Math.min(90, Math.max(DEFAULT_BOUND, Math.ceil(furthest / 10) * 10));
}

/** Position of a latitude on a ±`bound` scale, 0–100, south to north. */
export function latitudePercent(lat: number, bound: number): number {
  const clamped = Math.max(-bound, Math.min(bound, lat));
  return ((clamped + bound) / (2 * bound)) * 100;
}

// Rough label widths (px) for collision checks: "30° N" in 12px DM Mono,
// "Equator" in 14px semibold. Generous, so a borderline tick is dropped.
const TICK_LABEL_WIDTH = 38;
const EQUATOR_LABEL_WIDTH = 58;
const MIN_LABEL_GAP = 8;

/**
 * The 30° ticks that fit on a track `widthPx` wide: inside the scale (not
 * on its ends), inside the track, and clear of the equator label and of
 * each other. Worked outwards from the equator, so a crowded track keeps
 * the ticks nearest the middle.
 */
export function latitudeTicks(bound: number, widthPx: number): LatitudeTick[] {
  const ticks: LatitudeTick[] = [];
  for (const side of [-1, 1] as const) {
    // Edge of the last label placed on this side, px from the equator.
    let reach = EQUATOR_LABEL_WIDTH / 2;
    for (let deg = 30; deg < bound; deg += 30) {
      const lat = side * deg;
      const pct = latitudePercent(lat, bound);
      const fromCentre = Math.abs(pct - 50) * (widthPx / 100);
      const inner = fromCentre - TICK_LABEL_WIDTH / 2;
      const outer = fromCentre + TICK_LABEL_WIDTH / 2;
      if (inner < reach + MIN_LABEL_GAP || outer > widthPx / 2) continue;
      ticks.push({ lat, pct, label: `${deg}° ${side < 0 ? 'S' : 'N'}` });
      reach = outer;
    }
  }
  return ticks.sort((a, b) => a.lat - b.lat);
}

/**
 * Lay out the latitude record from the furthest-south and furthest-north
 * points. Either may be missing; when both are the same point it is drawn
 * once. Null when there is nothing to draw.
 */
export function layoutLatitude(
  south: LatitudeExtreme | null,
  north: LatitudeExtreme | null,
  trackWidthPx: number,
): LatitudeLayout | null {
  const points = [south, north].filter((p): p is LatitudeExtreme => p !== null);
  if (points.length === 0) return null;

  const bound = latitudeBound(points.map((p) => p.lat));
  const ticks = latitudeTicks(bound, trackWidthPx);

  const same = south !== null && north !== null && south.lat === north.lat;
  if (south && north && !same) {
    const from = latitudePercent(south.lat, bound);
    const to = latitudePercent(north.lat, bound);
    return {
      bound,
      span: north.lat - south.lat,
      labels: [
        {
          caption: 'Furthest south',
          value: latitudeLabel(south.lat),
          place: south.label,
          pct: from,
          anchor: 'start',
        },
        {
          caption: 'Furthest north',
          value: latitudeLabel(north.lat),
          place: north.label,
          pct: to,
          anchor: 'end',
        },
      ],
      bar: { from, to },
      leadSpacer: from,
      trailSpacer: 100 - to,
      ticks,
      description: `Furthest south ${latitudeLabel(south.lat)}, ${south.label}. Furthest north ${latitudeLabel(north.lat)}, ${north.label}.`,
    };
  }

  // One point: only one extreme is known, or both are the same place.
  const point = points[0]!;
  const caption = same ? 'Furthest north and south' : north ? 'Furthest north' : 'Furthest south';
  const pct = latitudePercent(point.lat, bound);
  // Anchor towards the middle so the label never runs off the near end.
  const anchor = pct <= 50 ? 'start' : 'end';
  return {
    bound,
    span: same ? 0 : null,
    labels: [{ caption, value: latitudeLabel(point.lat), place: point.label, pct, anchor }],
    bar: null,
    leadSpacer: anchor === 'start' ? pct : 0,
    trailSpacer: anchor === 'end' ? 100 - pct : 0,
    ticks,
    description: `${caption} ${latitudeLabel(point.lat)}, ${point.label}.`,
  };
}
