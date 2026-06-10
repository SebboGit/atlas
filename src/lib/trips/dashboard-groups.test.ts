import { describe, expect, it } from 'vitest';

import type { Trip } from './repo';

import { groupPastByYear, partitionForDashboard } from './dashboard-groups';

function makeTrip(overrides: Partial<Trip>): Trip {
  return {
    id: overrides.id ?? 'trip-1',
    userId: 'user-1',
    title: overrides.title ?? 'Trip',
    summary: null,
    status: overrides.status ?? 'planned',
    startDate: overrides.startDate ?? null,
    endDate: overrides.endDate ?? null,
    coverImageId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as Trip;
}

describe('partitionForDashboard', () => {
  it('routes active and planned to the upcoming surface, completed to past, drops archived', () => {
    const trips = [
      makeTrip({ id: 'planned-soon', status: 'planned', startDate: new Date('2026-08-01') }),
      makeTrip({ id: 'active-now', status: 'active', startDate: new Date('2026-05-20') }),
      makeTrip({ id: 'completed', status: 'completed', startDate: new Date('2025-09-10') }),
      makeTrip({ id: 'archived', status: 'archived', startDate: new Date('2024-01-01') }),
    ];
    const out = partitionForDashboard(trips);
    expect(out.upcoming.map((t) => t.id)).toEqual(['active-now', 'planned-soon']);
    expect(out.past.map((t) => t.id)).toEqual(['completed']);
  });

  it('within upcoming: active precedes planned regardless of startDate', () => {
    // The active trip starts later than the planned one — active still wins.
    const trips = [
      makeTrip({ id: 'planned', status: 'planned', startDate: new Date('2026-06-01') }),
      makeTrip({ id: 'active', status: 'active', startDate: new Date('2026-09-01') }),
    ];
    const { upcoming } = partitionForDashboard(trips);
    expect(upcoming.map((t) => t.id)).toEqual(['active', 'planned']);
  });

  it('within a status group: soonest startDate first, undated sinks last', () => {
    const trips = [
      makeTrip({ id: 'undated', status: 'planned', startDate: null }),
      makeTrip({ id: 'far', status: 'planned', startDate: new Date('2026-11-01') }),
      makeTrip({ id: 'soon', status: 'planned', startDate: new Date('2026-06-15') }),
    ];
    const { upcoming } = partitionForDashboard(trips);
    expect(upcoming.map((t) => t.id)).toEqual(['soon', 'far', 'undated']);
  });

  it('returns empty arrays for an empty input', () => {
    expect(partitionForDashboard([])).toEqual({ upcoming: [], past: [] });
  });
});

describe('groupPastByYear', () => {
  it('buckets trips by start year, newest year first', () => {
    const t2024 = makeTrip({ id: '2024', status: 'completed', startDate: new Date('2024-04-10') });
    const t2023 = makeTrip({ id: '2023', status: 'completed', startDate: new Date('2023-08-22') });
    const t2025 = makeTrip({ id: '2025', status: 'completed', startDate: new Date('2025-01-05') });
    const out = groupPastByYear([t2024, t2023, t2025]);
    expect(out.groups.map((g) => g.year)).toEqual([2025, 2024, 2023]);
    expect(out.undated).toEqual([]);
  });

  it('within a year: trips ordered by startDate descending (newest of the year first)', () => {
    const apr = makeTrip({ id: 'apr', status: 'completed', startDate: new Date('2024-04-10') });
    const nov = makeTrip({ id: 'nov', status: 'completed', startDate: new Date('2024-11-22') });
    const jan = makeTrip({ id: 'jan', status: 'completed', startDate: new Date('2024-01-05') });
    const out = groupPastByYear([apr, nov, jan]);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]!.trips.map((t) => t.id)).toEqual(['nov', 'apr', 'jan']);
  });

  it('falls back to endDate when startDate is missing', () => {
    // A trip dated only on the return leg should still land in the right year.
    const onlyEnd = makeTrip({
      id: 'only-end',
      status: 'completed',
      startDate: null,
      endDate: new Date('2024-10-01'),
    });
    const out = groupPastByYear([onlyEnd]);
    expect(out.groups.map((g) => g.year)).toEqual([2024]);
    expect(out.undated).toEqual([]);
  });

  it('routes trips with neither date to the undated bucket', () => {
    // Local-midnight construction, matching the shape `yearOf` documents
    // (date-only picks store local midnight; the year reads local
    // getters). The previous `new Date('2024-01-01')` was a UTC midnight
    // whose local year is 2023 west of UTC — the one fixture in this
    // suite sitting on a year boundary, so it skewed off-UTC runs.
    const dated = makeTrip({ id: 'dated', status: 'completed', startDate: new Date(2024, 0, 1) });
    const undated = makeTrip({ id: 'no-dates', status: 'completed' });
    const out = groupPastByYear([dated, undated]);
    expect(out.groups.map((g) => g.year)).toEqual([2024]);
    expect(out.undated.map((t) => t.id)).toEqual(['no-dates']);
  });

  it('within a year: missing startDate sinks below dated peers, tied by endDate desc', () => {
    const dated = makeTrip({
      id: 'dated',
      status: 'completed',
      startDate: new Date('2024-03-15'),
    });
    const endOnly = makeTrip({
      id: 'end-only',
      status: 'completed',
      startDate: null,
      endDate: new Date('2024-08-01'),
    });
    const out = groupPastByYear([endOnly, dated]);
    expect(out.groups[0]!.trips.map((t) => t.id)).toEqual(['dated', 'end-only']);
  });

  it('buckets a cross-year trip by its startDate year, not endDate', () => {
    const newYears = makeTrip({
      id: 'new-years',
      status: 'completed',
      startDate: new Date(2024, 11, 30), // 30 Dec 2024 local
      endDate: new Date(2025, 0, 4), // 04 Jan 2025 local
    });
    const out = groupPastByYear([newYears]);
    expect(out.groups.map((g) => g.year)).toEqual([2024]);
    expect(out.undated).toEqual([]);
  });

  it('keeps a manually-completed future-dated trip in its own year bucket', () => {
    // Edge case — a trip marked completed early. We don't second-guess
    // the user's status; the trip lands under its real year.
    const future = makeTrip({
      id: 'future',
      status: 'completed',
      startDate: new Date(2030, 5, 1),
    });
    const out = groupPastByYear([future]);
    expect(out.groups.map((g) => g.year)).toEqual([2030]);
  });

  it('returns empty groups for empty input', () => {
    expect(groupPastByYear([])).toEqual({ groups: [], undated: [] });
  });
});

describe('partitionForDashboard — undated active', () => {
  it('keeps an active trip with no startDate in the upcoming surface, sunk to the bottom', () => {
    const trips = [
      makeTrip({ id: 'planned-soon', status: 'planned', startDate: new Date(2026, 7, 1) }),
      makeTrip({ id: 'active-undated', status: 'active' }),
    ];
    const { upcoming } = partitionForDashboard(trips);
    // Active still wins over planned regardless of date — the active-
    // undated trip leads the section even without a date on it.
    expect(upcoming.map((t) => t.id)).toEqual(['active-undated', 'planned-soon']);
  });
});
