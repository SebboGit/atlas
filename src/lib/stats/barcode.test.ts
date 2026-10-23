import { describe, expect, it } from 'vitest';

import { BARCODE_MAX_YEARS, BARCODE_WIDTH, layoutBarcode } from './barcode';

const tallies = (counts: Record<number, number>) =>
  Object.entries(counts).map(([year, count]) => ({ year: Number(year), count }));

describe('layoutBarcode', () => {
  it('returns null when there are no trips', () => {
    expect(layoutBarcode([], 2026)).toBeNull();
    expect(layoutBarcode(tallies({ 2025: 0 }), 2026)).toBeNull();
  });

  it('groups bars by year, oldest first, with two-digit labels', () => {
    const layout = layoutBarcode(tallies({ 2026: 5, 2019: 3, 2020: 1 }), 2026)!;
    expect(layout.groups.map((g) => [g.year, g.label, g.bars])).toEqual([
      [2019, '’19', 3],
      [2020, '’20', 1],
      [2026, '’26', 5],
    ]);
  });

  it('marks only the current year', () => {
    const layout = layoutBarcode(tallies({ 2025: 2, 2026: 1 }), 2026)!;
    expect(layout.groups.map((g) => g.current)).toEqual([false, true]);
  });

  it('keeps the preferred sizes when they fit', () => {
    const layout = layoutBarcode(tallies({ 2024: 4, 2025: 6, 2026: 5 }), 2026)!;
    expect([layout.barWidth, layout.barGap, layout.groupGap]).toEqual([3, 3, 11]);
  });

  it('tightens the year gap before thinning the bars', () => {
    // The approved sample: 30 trips over 8 years.
    const layout = layoutBarcode(
      tallies({ 2019: 3, 2020: 1, 2021: 2, 2022: 4, 2023: 5, 2024: 4, 2025: 6, 2026: 5 }),
      2026,
    )!;
    expect(layout.barWidth).toBe(3);
    expect(layout.groupGap).toBeLessThan(11);
    expect(layout.width).toBeLessThanOrEqual(BARCODE_WIDTH);
  });

  it(`shows at most the ${BARCODE_MAX_YEARS} most recent years`, () => {
    const counts: Record<number, number> = {};
    for (let y = 2012; y <= 2026; y++) counts[y] = 2;
    const layout = layoutBarcode(tallies(counts), 2026)!;
    expect(layout.groups).toHaveLength(BARCODE_MAX_YEARS);
    expect(layout.groups[0]!.year).toBe(2019);
    expect(layout.groups.at(-1)!.year).toBe(2026);
  });

  it('thins bars and gaps until the block fits', () => {
    const layout = layoutBarcode(
      tallies({ 2019: 9, 2020: 8, 2021: 10, 2022: 9, 2023: 11, 2024: 9, 2025: 10, 2026: 8 }),
      2026,
    )!;
    expect(layout.barWidth).toBeLessThan(3);
    expect(layout.width).toBeLessThanOrEqual(BARCODE_WIDTH);
  });

  it('never goes below the 1px floor', () => {
    const layout = layoutBarcode(tallies({ 2025: 60, 2026: 50 }), 2026)!;
    expect(layout.barWidth).toBe(1);
    expect(layout.barGap).toBe(1);
  });

  it('drops the oldest years when even the floor overflows, keeping the newest', () => {
    const layout = layoutBarcode(tallies({ 2024: 40, 2025: 80, 2026: 80 }), 2026)!;
    expect(layout.groups.map((g) => g.year)).toEqual([2026]);
    expect(layout.groups[0]!.current).toBe(true);
    expect(layout.width).toBeLessThanOrEqual(BARCODE_WIDTH);
    // The summary only names the years still drawn.
    expect(layout.description).toBe('Trips per year: 2026, 80 trips.');
  });

  it('keeps as many recent years as fit at the floor', () => {
    const layout = layoutBarcode(tallies({ 2023: 70, 2024: 30, 2025: 20, 2026: 10 }), 2026)!;
    expect(layout.groups.map((g) => g.year)).toEqual([2024, 2025, 2026]);
    expect(layout.width).toBeLessThanOrEqual(BARCODE_WIDTH);
  });

  it('draws only the bars that fit when one year alone is too busy', () => {
    const layout = layoutBarcode(tallies({ 2026: 200 }), 2026)!;
    expect(layout.groups[0]!.bars).toBe(120);
    expect(layout.width).toBeLessThanOrEqual(BARCODE_WIDTH);
    expect(layout.description).toBe('Trips per year: 2026, 200 trips.');
  });

  it('reserves room for each year label, even under a single bar', () => {
    const layout = layoutBarcode(tallies({ 2025: 1, 2026: 1 }), 2026)!;
    // Two 22px label columns and one gap between them.
    expect(layout.width).toBe(22 + 22 + layout.groupGap);
  });

  it('summarises the bars for screen readers', () => {
    const layout = layoutBarcode(tallies({ 2025: 1, 2026: 4 }), 2026)!;
    expect(layout.description).toBe('Trips per year: 2025, 1 trip; 2026, 4 trips.');
  });
});
