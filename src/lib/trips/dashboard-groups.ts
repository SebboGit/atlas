// Dashboard grouping for the chronological /trips view (#10).
//
// The dashboard partitions trips into two surfaces:
//   - Upcoming: status === 'active' OR status === 'planned' — current
//     and next-up trips, shown as one unified card grid at the top.
//   - Past:     status === 'completed' — historical trips, grouped by
//     start year with sticky year headers underneath.
//
// `archived` trips are NOT part of the dashboard view — they live
// behind the archived-only filter toggle on the same page.
//
// Sort rules (chosen to match the dashboard's mental model):
//   - Upcoming: active first (you're on it right now), then planned by
//     startDate ascending (soonest first); undated planned trips sink
//     to the bottom of the section.
//   - Past:    by start year descending; within a year by startDate
//     descending (newest first); completed trips with neither
//     startDate nor endDate fall into a separate "undated" bucket
//     rendered at the bottom.

import type { Trip } from './repo';

export interface DashboardPartition {
  upcoming: Trip[];
  past: Trip[];
}

/**
 * Split a flat trip list into the two dashboard sections. Archived
 * trips are dropped — the page's archived toggle uses a different
 * fetch path.
 */
export function partitionForDashboard(trips: ReadonlyArray<Trip>): DashboardPartition {
  const upcoming: Trip[] = [];
  const past: Trip[] = [];
  for (const trip of trips) {
    if (trip.status === 'active' || trip.status === 'planned') {
      upcoming.push(trip);
    } else if (trip.status === 'completed') {
      past.push(trip);
    }
    // archived — caller handles separately
  }
  return {
    upcoming: upcoming.sort(compareUpcoming),
    past, // year-grouping is the next step; ordering inside year happens there
  };
}

export interface PastYearGroup {
  year: number;
  trips: Trip[];
}

export interface PastTripsGrouped {
  /** Year buckets, newest year first. */
  groups: PastYearGroup[];
  /** Completed trips with no startDate AND no endDate — rendered last under an "Undated" header. */
  undated: Trip[];
}

/**
 * Bucket past trips by year. A trip's year is its `startDate` year,
 * falling back to `endDate` so a trip with only a return date still
 * lands in the right bucket. Trips with neither date fall into the
 * undated bucket.
 *
 * Within a year, trips are sorted by startDate descending so the
 * newest trip of that year reads first; trips missing startDate
 * inside an otherwise-dated year sink to the bottom of that year.
 */
export function groupPastByYear(trips: ReadonlyArray<Trip>): PastTripsGrouped {
  const byYear = new Map<number, Trip[]>();
  const undated: Trip[] = [];

  for (const trip of trips) {
    const year = yearOf(trip);
    if (year === null) {
      undated.push(trip);
      continue;
    }
    const bucket = byYear.get(year) ?? [];
    bucket.push(trip);
    byYear.set(year, bucket);
  }

  const groups: PastYearGroup[] = Array.from(byYear.keys())
    .sort((a, b) => b - a)
    .map((year) => ({
      year,
      trips: byYear.get(year)!.slice().sort(compareWithinYear),
    }));

  return { groups, undated };
}

// Year derivation: startDate wins; endDate is a secondary signal so a
// trip dated only on the return leg still buckets correctly. Uses the
// runtime's *local* year, matching what `toLocaleDateString` renders on
// the trip card — so a trip the user picked as "1 Jan 2026" in JST
// buckets into 2026 even though its UTC instant is 2025-12-31. The
// date picker stores date-only inputs as local-midnight (see
// validators.ts), so this matches the value the user typed.
function yearOf(trip: Trip): number | null {
  if (trip.startDate) return trip.startDate.getFullYear();
  if (trip.endDate) return trip.endDate.getFullYear();
  return null;
}

// Comparator for the upcoming grid. Active trips precede planned
// regardless of date — you want the trip you're on right now to read
// first. Within a status, soonest startDate first; trips with no
// startDate inside the same status group sink to the bottom.
function compareUpcoming(a: Trip, b: Trip): number {
  if (a.status === 'active' && b.status !== 'active') return -1;
  if (b.status === 'active' && a.status !== 'active') return 1;
  return compareByStartAsc(a, b);
}

// Within-year comparator for past. startDate desc (newest first);
// missing startDate sinks last.
function compareWithinYear(a: Trip, b: Trip): number {
  if (a.startDate === null && b.startDate === null) {
    return (b.endDate?.getTime() ?? 0) - (a.endDate?.getTime() ?? 0);
  }
  if (a.startDate === null) return 1;
  if (b.startDate === null) return -1;
  return b.startDate.getTime() - a.startDate.getTime();
}

function compareByStartAsc(a: Trip, b: Trip): number {
  if (a.startDate === null && b.startDate === null) return 0;
  if (a.startDate === null) return 1;
  if (b.startDate === null) return -1;
  return a.startDate.getTime() - b.startDate.getTime();
}
