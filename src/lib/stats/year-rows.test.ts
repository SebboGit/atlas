import { describe, expect, it } from 'vitest';

import { buildYearRows, splitYearRows, tripsSince } from './year-rows';

const yoy = {
  tripsPerYear: [
    { year: 2019, count: 3 },
    { year: 2021, count: 2 },
    { year: 2026, count: 5 },
  ],
  nightsPerYear: [
    { year: 2019, count: 24 },
    // A New Year's trip: its hotel night lands in the year after it started.
    { year: 2022, count: 2 },
    { year: 2026, count: 48 },
  ],
  newCountriesPerYear: [
    { year: 2019, count: 4 },
    { year: 2026, count: 1 },
  ],
};

describe('buildYearRows', () => {
  it('folds the three tallies into one row per year, newest first', () => {
    const rows = buildYearRows(yoy, 2026);
    expect(rows.map((r) => [r.year, r.trips, r.nights, r.newCountries])).toEqual([
      [2026, 5, 48, 1],
      [2022, 0, 2, 0],
      [2021, 2, 0, 0],
      [2019, 3, 24, 4],
    ]);
  });

  it('leaves out years with nothing in them', () => {
    const years = buildYearRows(yoy, 2026).map((r) => r.year);
    expect(years).not.toContain(2020);
    expect(years).not.toContain(2023);
  });

  it('scales the nights bar to the busiest year', () => {
    const rows = buildYearRows(yoy, 2026);
    expect(rows[0]!.nightsPct).toBe(100);
    expect(rows.at(-1)!.nightsPct).toBe(50);
    expect(rows.find((r) => r.year === 2021)!.nightsPct).toBe(0);
  });

  it('marks the current year only', () => {
    expect(buildYearRows(yoy, 2026).map((r) => r.current)).toEqual([true, false, false, false]);
    expect(buildYearRows(yoy, 2027).some((r) => r.current)).toBe(false);
  });

  it('has no rows without any dated tally', () => {
    expect(
      buildYearRows({ tripsPerYear: [], nightsPerYear: [], newCountriesPerYear: [] }, 2026),
    ).toEqual([]);
  });

  it('copes with no nights at all', () => {
    const rows = buildYearRows(
      { tripsPerYear: [{ year: 2025, count: 1 }], nightsPerYear: [], newCountriesPerYear: [] },
      2026,
    );
    expect(rows).toEqual([
      { year: 2025, trips: 1, nights: 0, newCountries: 0, nightsPct: 0, current: false },
    ]);
  });
});

describe('splitYearRows', () => {
  const rows = buildYearRows(
    {
      tripsPerYear: [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((year) => ({
        year,
        count: 1,
      })),
      nightsPerYear: [],
      newCountriesPerYear: [],
    },
    2026,
  );

  it('shows the five most recent years and folds the rest', () => {
    const { shown, folded, foldedLabel } = splitYearRows(rows);
    expect(shown.map((r) => r.year)).toEqual([2026, 2025, 2024, 2023, 2022]);
    expect(folded.map((r) => r.year)).toEqual([2021, 2020, 2019]);
    expect(foldedLabel).toBe('2019 – 2021');
  });

  it('labels a single folded year on its own', () => {
    expect(splitYearRows(rows.slice(0, 6)).foldedLabel).toBe('2021');
  });

  it('folds nothing when everything fits', () => {
    expect(splitYearRows(rows.slice(0, 5))).toMatchObject({ folded: [], foldedLabel: null });
  });
});

describe('tripsSince', () => {
  it('totals the dated trips and finds the first year', () => {
    expect(tripsSince(yoy)).toEqual({ trips: 10, since: 2019 });
  });

  it('is null without dated trips', () => {
    expect(tripsSince({ tripsPerYear: [], nightsPerYear: [], newCountriesPerYear: [] })).toBeNull();
  });
});
