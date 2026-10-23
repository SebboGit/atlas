// Layout for the lifetime pass's barcode: one bar per trip, grouped by
// year, with a two-digit year label under each group. Pure — the stub
// renders the result with inline pixel sizes.

import type { YearTally } from './repo';

/** The most recent years the barcode shows; older years drop off. */
export const BARCODE_MAX_YEARS = 8;

/**
 * Width the barcode has to fit, px: the stub's inner width (`lg:w-80`
 * minus `px-10` on each side, see LifetimePass). The barcode only shows
 * once the stub is a side column; the phone's bottom strip has none.
 */
export const BARCODE_WIDTH = 240;

// A year label ("’19", 12px DM Mono) is three characters at 0.6em, so a
// group is never narrower than this or neighbouring labels would touch.
const LABEL_WIDTH = 22;

// Preferred sizes first. The gap between years tightens before the bars
// thin; bars and the gaps between them bottom out at 1px, the gap
// between years at 4px.
const STEPS: ReadonlyArray<{ bar: number; gap: number; groupGap: number }> = [
  { bar: 3, gap: 3, groupGap: 11 },
  { bar: 3, gap: 3, groupGap: 8 },
  { bar: 3, gap: 2, groupGap: 8 },
  { bar: 2, gap: 2, groupGap: 8 },
  { bar: 2, gap: 2, groupGap: 6 },
  { bar: 2, gap: 1, groupGap: 6 },
  { bar: 1, gap: 1, groupGap: 6 },
  { bar: 1, gap: 1, groupGap: 4 },
];

export interface BarcodeGroup {
  year: number;
  /** Two-digit label with a typographic apostrophe: `’19`. */
  label: string;
  /** Bars drawn: one per trip, unless one year alone overflows the stub. */
  bars: number;
  current: boolean;
}

export interface BarcodeLayout {
  groups: BarcodeGroup[];
  barWidth: number;
  barGap: number;
  groupGap: number;
  /** Total width of the block at these sizes, px. */
  width: number;
  /** Screen-reader summary of what the bars show. */
  description: string;
}

function blockWidth(groups: BarcodeGroup[], bar: number, gap: number, groupGap: number): number {
  let width = 0;
  for (const g of groups) {
    width += Math.max(g.bars * bar + (g.bars - 1) * gap, LABEL_WIDTH);
  }
  return width + (groups.length - 1) * groupGap;
}

/**
 * Lay out the barcode for `tripsPerYear`: the {@link BARCODE_MAX_YEARS}
 * most recent years that have trips, oldest on the left, at the widest
 * bar size that fits `maxWidth`. When even the 1px floor overflows
 * (dozens of trips a year), the oldest years drop off until the rest fit,
 * keeping the newest; a single year too busy for the stub on its own
 * draws as many bars as fit and its count stays in the description. So
 * the block never wraps, never overlaps and never clips the current year.
 * Null when there are no trips to draw.
 */
export function layoutBarcode(
  tripsPerYear: YearTally[],
  currentYear: number,
  maxWidth: number = BARCODE_WIDTH,
): BarcodeLayout | null {
  let groups: BarcodeGroup[] = tripsPerYear
    .filter((t) => t.count > 0)
    .sort((a, b) => a.year - b.year)
    .slice(-BARCODE_MAX_YEARS)
    .map((t) => ({
      year: t.year,
      label: `’${String(t.year).slice(-2)}`,
      bars: t.count,
      current: t.year === currentYear,
    }));
  if (groups.length === 0) return null;

  const floor = STEPS[STEPS.length - 1]!;
  while (groups.length > 1 && blockWidth(groups, floor.bar, floor.gap, floor.groupGap) > maxWidth) {
    groups = groups.slice(1);
  }
  // One year left and still too wide: 1px bars with 1px gaps fit this many.
  const maxBars = Math.floor((maxWidth + floor.gap) / (floor.bar + floor.gap));
  const description = `Trips per year: ${groups
    .map((g) => `${g.year}, ${g.bars} ${g.bars === 1 ? 'trip' : 'trips'}`)
    .join('; ')}.`;
  groups = groups.map((g) => ({ ...g, bars: Math.min(g.bars, maxBars) }));

  const step = STEPS.find((s) => blockWidth(groups, s.bar, s.gap, s.groupGap) <= maxWidth) ?? floor;

  return {
    groups,
    barWidth: step.bar,
    barGap: step.gap,
    groupGap: step.groupGap,
    width: blockWidth(groups, step.bar, step.gap, step.groupGap),
    description,
  };
}
