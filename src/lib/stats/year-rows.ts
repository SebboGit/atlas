// Year-by-year tickets: the repo's three per-year tallies folded into one
// row per year. Pure.

import type { YearOverYearStats } from './repo';

export interface YearRow {
  year: number;
  trips: number;
  nights: number;
  newCountries: number;
  /** Nights as a share of the busiest year's, 0–100, for the bar. */
  nightsPct: number;
  /** The year still in progress — its stub reads "so far". */
  current: boolean;
}

/**
 * One row per year that has anything in it, newest first. The repo omits
 * years with a zero tally from each strip, so a year shows up here if any
 * of its trips, nights or new countries is non-zero, with zeros filling
 * the rest. A quiet year in between (nothing at all) has no row: the
 * ticket's year stub makes the gap readable without an empty ticket.
 */
export function buildYearRows(yoy: YearOverYearStats, currentYear: number): YearRow[] {
  const byYear = new Map<number, { trips: number; nights: number; newCountries: number }>();
  const row = (year: number) => {
    let r = byYear.get(year);
    if (!r) {
      r = { trips: 0, nights: 0, newCountries: 0 };
      byYear.set(year, r);
    }
    return r;
  };
  for (const t of yoy.tripsPerYear) row(t.year).trips = t.count;
  for (const t of yoy.nightsPerYear) row(t.year).nights = t.count;
  for (const t of yoy.newCountriesPerYear) row(t.year).newCountries = t.count;

  const maxNights = Math.max(0, ...[...byYear.values()].map((r) => r.nights));
  return [...byYear.entries()]
    .filter(([, r]) => r.trips > 0 || r.nights > 0 || r.newCountries > 0)
    .sort(([a], [b]) => b - a)
    .map(([year, r]) => ({
      year,
      ...r,
      nightsPct: maxNights > 0 ? (r.nights / maxNights) * 100 : 0,
      current: year === currentYear,
    }));
}

/** Years a phone shows before the rest fold behind a disclosure. */
export const PHONE_VISIBLE_YEARS = 5;

/**
 * Split rows for the phone: the most recent {@link PHONE_VISIBLE_YEARS}
 * show, the rest fold away behind a button labelled with their range
 * ("2019 – 2021", or a single year).
 */
export function splitYearRows(
  rows: YearRow[],
  visible: number = PHONE_VISIBLE_YEARS,
): { shown: YearRow[]; folded: YearRow[]; foldedLabel: string | null } {
  const shown = rows.slice(0, visible);
  const folded = rows.slice(visible);
  if (folded.length === 0) return { shown, folded, foldedLabel: null };
  const newest = folded[0]!.year;
  const oldest = folded.at(-1)!.year;
  return {
    shown,
    folded,
    foldedLabel: newest === oldest ? String(newest) : `${oldest} – ${newest}`,
  };
}

/**
 * The stub's summary of the whole history: total dated trips and the
 * first year with one, for "30 trips since 2019". Null without trips.
 */
export function tripsSince(yoy: YearOverYearStats): { trips: number; since: number } | null {
  const years = yoy.tripsPerYear.filter((t) => t.count > 0);
  if (years.length === 0) return null;
  return {
    trips: years.reduce((sum, t) => sum + t.count, 0),
    since: Math.min(...years.map((t) => t.year)),
  };
}
