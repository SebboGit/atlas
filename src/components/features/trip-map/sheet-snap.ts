// Snap maths for the trip map's timeline sheet (#159). Pure, so the
// release rules are tested without a DOM; use-sheet-drag.ts feeds it the
// pointer track and applies the answer.
//
// Positions are "visible fractions": the share of the viewport's height
// the sheet shows above the bottom edge — the unit the snap points are
// written in.

/**
 * Release speed, in px/ms, from which a drag counts as a flick and moves
 * on to the next snap point in its direction however short it was.
 * vaul's threshold, so the gesture feels as it did before.
 */
export const FLICK_VELOCITY = 0.4;

/**
 * How far, in px, a press may wander before it becomes a drag. Below it
 * the press stays a tap: the handle toggles, a rail row selects.
 */
export const DRAG_SLOP = 6;

/**
 * Only the last stretch of the track sets the release speed, so a drag
 * that came to rest before letting go settles by distance, not by how
 * fast it moved earlier.
 */
export const VELOCITY_WINDOW_MS = 100;

/** One pointer position: client Y in px, timestamp in ms. */
export interface TrackSample {
  y: number;
  t: number;
}

/** Keep a dragged position between the lowest and the highest snap. */
export function clampVisible(visible: number, snaps: readonly number[]): number {
  return Math.min(Math.max(visible, Math.min(...snaps)), Math.max(...snaps));
}

/**
 * Speed of the pointer over the last {@link VELOCITY_WINDOW_MS} before
 * `releasedAt`, in px/ms. Positive when the finger moves UP the screen
 * (the sheet grows), so its sign reads the same way as a visible
 * fraction. Zero when the window holds fewer than two samples — a drag
 * that paused before release.
 */
export function releaseVelocity(track: readonly TrackSample[], releasedAt: number): number {
  const recent = track.filter((s) => releasedAt - s.t <= VELOCITY_WINDOW_MS);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (!first || !last || last.t <= first.t) return 0;
  return (first.y - last.y) / (last.t - first.t);
}

/**
 * The snap point a released drag settles on. A flick goes to the next
 * snap in its direction (or stays at the end it is already past); a
 * slower release goes to the nearest snap.
 */
export function settleSnap(snaps: readonly number[], visible: number, velocity: number): number {
  const sorted = [...snaps].sort((a, b) => a - b);
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];
  if (lowest === undefined || highest === undefined) return visible;

  if (velocity >= FLICK_VELOCITY) return sorted.find((s) => s > visible) ?? highest;
  if (velocity <= -FLICK_VELOCITY) return sorted.findLast((s) => s < visible) ?? lowest;

  return sorted.reduce((best, s) => (Math.abs(s - visible) < Math.abs(best - visible) ? s : best));
}

/**
 * The snap one step up (`1`) or down (`-1`) from `current` — the arrow
 * keys on the handle. Stays put at either end.
 */
export function stepSnap(snaps: readonly number[], current: number, direction: 1 | -1): number {
  const sorted = [...snaps].sort((a, b) => a - b);
  const next =
    direction === 1 ? sorted.find((s) => s > current) : sorted.findLast((s) => s < current);
  return next ?? current;
}

/**
 * The snaps as they apply on a viewport `viewportPx` tall: the lowest is
 * raised to at least `minLowestPx`, so on a very short viewport (a phone
 * in landscape, or 400% zoom) the peek still shows the whole header.
 * Never raised past the next snap up. Same order as `snaps`.
 */
export function effectiveSnaps(
  snaps: readonly number[],
  viewportPx: number,
  minLowestPx: number,
): number[] {
  const sorted = [...snaps].sort((a, b) => a - b);
  const lowest = sorted[0];
  if (lowest === undefined || viewportPx <= 0) return [...snaps];
  const floor = Math.min(minLowestPx / viewportPx, sorted[1] ?? Infinity);
  return snaps.map((s) => (s === lowest ? Math.max(s, floor) : s));
}

/**
 * The sheet's resting `translateY` at `snap`, as CSS. The sheet is as
 * tall as its highest snap and anchored to the bottom edge, so it moves
 * down by its own height less what the snap shows — and never shows less
 * than `minRem`, the CSS twin of {@link effectiveSnaps}. Rounded so float
 * noise (0.18 × 100 = 18.000000000000004) stays out of the inline style.
 */
export function snapTranslateCss(snap: number, minRem: number): string {
  const svh = Math.round(snap * 100 * 1000) / 1000;
  return `calc(100% - max(${svh}svh, ${minRem}rem))`;
}
