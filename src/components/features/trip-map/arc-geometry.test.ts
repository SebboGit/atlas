import { describe, expect, it } from 'vitest';

import {
  CURVE_RATIO,
  curveRatioFor,
  curvedArcCoords,
  splitAtAntimeridian,
  TRANSIT_CURVE_RATIO,
} from './arc-geometry';

import type { TripMapArc } from '@/lib/trip-map/repo';

function arc(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  kind: TripMapArc['kind'] = 'flight',
): TripMapArc {
  return {
    segmentId: 'seg-test',
    kind,
    originLat,
    originLng,
    destLat,
    destLng,
    originCountry: 'XX',
    destCountry: 'YY',
  };
}

describe('splitAtAntimeridian', () => {
  it('returns an empty array for empty input', () => {
    expect(splitAtAntimeridian([])).toEqual([]);
  });

  it('passes a polyline that stays within [-180, 180] through unchanged', () => {
    const input: [number, number][] = [
      [0, 0],
      [10, 5],
      [20, 10],
    ];
    expect(splitAtAntimeridian(input)).toEqual([input]);
  });

  it('splits a polyline that crosses east over +180 into two segments', () => {
    // 170 → 190 (= -170 normalised). Antimeridian crossing at lng=180.
    const result = splitAtAntimeridian([
      [170, 0],
      [190, 10],
    ]);
    expect(result).toHaveLength(2);
    // First segment ends at +180 (east edge).
    const first = result[0]!;
    expect(first[0]).toEqual([170, 0]);
    expect(first[first.length - 1]![0]).toBe(180);
    expect(first[first.length - 1]![1]).toBeCloseTo(5);
    // Second segment starts at -180 with the same crossing latitude
    // and ends at the destination, normalised.
    const second = result[1]!;
    expect(second[0]).toEqual([-180, first[first.length - 1]![1]]);
    expect(second[second.length - 1]).toEqual([-170, 10]);
  });

  it('splits a polyline that crosses west over -180 into two segments', () => {
    // -170 → -190 (= +170 normalised). Antimeridian crossing at lng=-180.
    const result = splitAtAntimeridian([
      [-170, 0],
      [-190, 10],
    ]);
    expect(result).toHaveLength(2);
    const first = result[0]!;
    expect(first[0]).toEqual([-170, 0]);
    expect(first[first.length - 1]![0]).toBe(-180);
    const second = result[1]!;
    expect(second[0]![0]).toBe(180);
    expect(second[second.length - 1]).toEqual([170, 10]);
  });
});

describe('curvedArcCoords', () => {
  // The full bezier sweeps slightly past the straight line because of
  // the perpendicular control-point offset, so we assert ranges rather
  // than exact endpoints/longitudes.

  it('produces a single segment for an arc that does not cross the antimeridian', () => {
    // MUC (48.35, 11.78) → MCT (23.59, 58.28) — a non-wrapping arc.
    const result = curvedArcCoords(arc(48.35, 11.78, 23.59, 58.28));
    expect(result).toHaveLength(1);
    const allLngs = result[0]!.map(([lng]) => lng);
    expect(Math.min(...allLngs)).toBeGreaterThan(0);
    expect(Math.max(...allLngs)).toBeLessThan(80);
  });

  it('takes the short way across the Pacific for HND→LAX (not over Europe)', () => {
    // HND (35.55, 139.78) → LAX (33.94, -118.41). Raw dx = -258.19;
    // before the fix this swept west across Europe. After the fix,
    // the bezier should go east, cross the antimeridian, and land at
    // LAX. We assert this by checking that the result splits at ±180
    // and the first segment's longitudes stay east of HND.
    const result = curvedArcCoords(arc(35.55, 139.78, 33.94, -118.41));
    expect(result.length).toBe(2);

    const firstLngs = result[0]!.map(([lng]) => lng);
    const secondLngs = result[1]!.map(([lng]) => lng);

    // Segment 1: starts at HND's longitude, ends at +180.
    expect(firstLngs[0]).toBeCloseTo(139.78);
    expect(firstLngs[firstLngs.length - 1]).toBe(180);
    // Every point in segment 1 is east of HND or at the antimeridian
    // — never on the wrong (European) side of the globe.
    for (const lng of firstLngs) {
      expect(lng).toBeGreaterThanOrEqual(139.78);
      expect(lng).toBeLessThanOrEqual(180);
    }
    // Segment 2: starts at -180, ends at LAX's longitude. Every point
    // sits in [-180, LAX] — i.e. continues east of the antimeridian
    // toward LAX, not west toward Europe.
    expect(secondLngs[0]).toBe(-180);
    expect(secondLngs[secondLngs.length - 1]).toBeCloseTo(-118.41);
    for (const lng of secondLngs) {
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(-118.41);
    }
  });

  it('also takes the short way for the return LAX→HND', () => {
    // The return arc should mirror HND→LAX across the antimeridian.
    // Raw dx = +258.19; the fix shifts westward.
    const result = curvedArcCoords(arc(33.94, -118.41, 35.55, 139.78));
    expect(result.length).toBe(2);
    const firstLngs = result[0]!.map(([lng]) => lng);
    const secondLngs = result[1]!.map(([lng]) => lng);

    // Segment 1: LAX out to the -180 boundary, all longitudes in [-180, LAX].
    expect(firstLngs[0]).toBeCloseTo(-118.41);
    expect(firstLngs[firstLngs.length - 1]).toBe(-180);
    for (const lng of firstLngs) {
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(-118.41);
    }
    // Segment 2: +180 boundary back to HND, all longitudes in [HND, 180].
    expect(secondLngs[0]).toBe(180);
    expect(secondLngs[secondLngs.length - 1]).toBeCloseTo(139.78);
    for (const lng of secondLngs) {
      expect(lng).toBeGreaterThanOrEqual(139.78);
      expect(lng).toBeLessThanOrEqual(180);
    }
  });

  it('returns a degenerate two-point line when origin and destination coincide', () => {
    const result = curvedArcCoords(arc(0, 0, 0, 0));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
});

describe('curvedArcCoords — curve strength by route kind (ADR-0019)', () => {
  // Largest perpendicular distance of any sample from the straight chord.
  function maxDeviation(line: [number, number][], a: [number, number], b: [number, number]) {
    const [x1, y1] = a;
    const [x2, y2] = b;
    const len = Math.hypot(x2 - x1, y2 - y1);
    return Math.max(
      ...line.map(([x, y]) => Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / len),
    );
  }

  it('picks the ratio from the arc kind', () => {
    expect(curveRatioFor('flight')).toBe(CURVE_RATIO);
    expect(curveRatioFor('transit')).toBe(TRANSIT_CURVE_RATIO);
    expect(TRANSIT_CURVE_RATIO).toBeLessThan(CURVE_RATIO);
  });

  it('bends a transit line less than a flight arc between the same points', () => {
    const flight = curvedArcCoords(arc(35.68, 139.77, 34.99, 135.76, 'flight'))[0]!;
    const transit = curvedArcCoords(arc(35.68, 139.77, 34.99, 135.76, 'transit'))[0]!;
    const ends: [[number, number], [number, number]] = [
      [139.77, 35.68],
      [135.76, 34.99],
    ];
    expect(maxDeviation(transit, ...ends)).toBeGreaterThan(0);
    expect(maxDeviation(transit, ...ends)).toBeLessThan(maxDeviation(flight, ...ends));
  });

  it('draws a straight line at ratio 0', () => {
    const line = curvedArcCoords(arc(0, 0, 10, 10, 'transit'), 0)[0]!;
    for (const [x, y] of line) expect(x).toBeCloseTo(y, 9);
  });

  it('bows an out-and-back transit pair to opposite sides', () => {
    const out = curvedArcCoords(arc(0, 0, 0, 10, 'transit'))[0]!;
    const back = curvedArcCoords(arc(0, 10, 0, 0, 'transit'))[0]!;
    const mid = Math.floor(out.length / 2);
    expect(Math.sign(out[mid]![1])).toBe(-Math.sign(back[mid]![1]));
  });
});
