import { describe, expect, it } from 'vitest';

import {
  clampVisible,
  FLICK_VELOCITY,
  effectiveSnaps,
  releaseVelocity,
  settleSnap,
  snapTranslateCss,
  stepSnap,
  VELOCITY_WINDOW_MS,
} from './sheet-snap';

const PEEK = 0.18;
const OPEN = 0.82;
const SNAPS = [PEEK, OPEN] as const;

describe('clampVisible', () => {
  it('keeps a position between the lowest and highest snap', () => {
    expect(clampVisible(0.5, SNAPS)).toBe(0.5);
    expect(clampVisible(0.05, SNAPS)).toBe(PEEK);
    expect(clampVisible(0.95, SNAPS)).toBe(OPEN);
  });

  it('does not care about the order the snaps are listed in', () => {
    expect(clampVisible(1, [OPEN, PEEK])).toBe(OPEN);
  });
});

describe('releaseVelocity', () => {
  it('is positive when the finger moves up the screen', () => {
    const track = [
      { y: 500, t: 0 },
      { y: 450, t: 50 },
      { y: 400, t: 100 },
    ];
    expect(releaseVelocity(track, 100)).toBe(1);
  });

  it('is negative when the finger moves down', () => {
    const track = [
      { y: 100, t: 0 },
      { y: 150, t: 50 },
    ];
    expect(releaseVelocity(track, 50)).toBe(-1);
  });

  it('only reads the last window before release', () => {
    // A fast start, then a slow finish: only the finish counts.
    const track = [
      { y: 600, t: 0 },
      { y: 300, t: 20 },
      { y: 290, t: 200 },
      { y: 280, t: 220 },
    ];
    expect(releaseVelocity(track, 220)).toBe(0.5);
  });

  it('is zero for a drag that paused before letting go', () => {
    const track = [
      { y: 600, t: 0 },
      { y: 300, t: 50 },
    ];
    expect(releaseVelocity(track, 50 + VELOCITY_WINDOW_MS + 1)).toBe(0);
  });

  it('is zero for a single sample or an empty track', () => {
    expect(releaseVelocity([{ y: 10, t: 5 }], 5)).toBe(0);
    expect(releaseVelocity([], 5)).toBe(0);
  });
});

describe('settleSnap', () => {
  it('goes to the nearest snap on a slow release', () => {
    expect(settleSnap(SNAPS, 0.3, 0)).toBe(PEEK);
    expect(settleSnap(SNAPS, 0.7, 0)).toBe(OPEN);
    // Just under the threshold is still a slow release.
    expect(settleSnap(SNAPS, 0.3, FLICK_VELOCITY - 0.01)).toBe(PEEK);
  });

  it('follows a flick up past the nearest snap', () => {
    expect(settleSnap(SNAPS, 0.2, FLICK_VELOCITY)).toBe(OPEN);
  });

  it('follows a flick down past the nearest snap', () => {
    expect(settleSnap(SNAPS, 0.8, -FLICK_VELOCITY)).toBe(PEEK);
  });

  it('stays at the end a flick is already at', () => {
    expect(settleSnap(SNAPS, OPEN, 2)).toBe(OPEN);
    expect(settleSnap(SNAPS, PEEK, -2)).toBe(PEEK);
  });

  it('moves one snap at a time with three or more', () => {
    expect(settleSnap([0.1, 0.5, 0.9], 0.15, 1)).toBe(0.5);
    expect(settleSnap([0.9, 0.1, 0.5], 0.85, -1)).toBe(0.5);
  });
});

describe('stepSnap', () => {
  it('steps up and down between snaps', () => {
    expect(stepSnap(SNAPS, PEEK, 1)).toBe(OPEN);
    expect(stepSnap(SNAPS, OPEN, -1)).toBe(PEEK);
  });

  it('stays put at either end', () => {
    expect(stepSnap(SNAPS, OPEN, 1)).toBe(OPEN);
    expect(stepSnap(SNAPS, PEEK, -1)).toBe(PEEK);
  });
});

describe('effectiveSnaps', () => {
  it('leaves the snaps alone when the peek already clears the floor', () => {
    expect(effectiveSnaps(SNAPS, 640, 56)).toEqual([PEEK, OPEN]);
  });

  it('raises the peek on a short viewport so the header fits', () => {
    // 18% of 220px is 39.6px, under a 56px header.
    const [peek, open] = effectiveSnaps(SNAPS, 220, 56);
    expect(peek).toBeCloseTo(56 / 220);
    expect(open).toBe(OPEN);
  });

  it('never raises the peek past the next snap', () => {
    expect(effectiveSnaps(SNAPS, 50, 56)).toEqual([OPEN, OPEN]);
  });

  it('keeps the order the snaps came in', () => {
    expect(effectiveSnaps([OPEN, PEEK], 220, 56)[1]).toBeCloseTo(56 / 220);
  });
});

describe('snapTranslateCss', () => {
  it('moves the sheet down by its height less what the snap shows', () => {
    expect(snapTranslateCss(PEEK, 3.5)).toBe('calc(100% - max(18svh, 3.5rem))');
    expect(snapTranslateCss(OPEN, 3.5)).toBe('calc(100% - max(82svh, 3.5rem))');
  });
});
