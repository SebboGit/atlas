import { describe, expect, it } from 'vitest';

import type { Segment } from '@/lib/segments';

import {
  classifyDay,
  classifyDays,
  daysContainSegment,
  findDayKeyForSegment,
  isOngoing,
  splitCollapsedDays,
  summariseLocations,
  type ClassifiedDay,
} from './day-temporal';
import type { DayBucket } from './group-by-day';

// Local-midnight Dates throughout — the same shape `groupSegmentsByDay`
// produces for bucket dates.
const today = new Date(2026, 4, 21); // 21 May 2026

function makeSegment(overrides: Partial<Segment>): Segment {
  return {
    id: 's-1',
    type: 'activity',
    tripId: 'trip-1',
    title: 'Thing',
    locationName: null,
    startsAt: null,
    ...overrides,
  } as unknown as Segment;
}

describe('classifyDay', () => {
  it('classifies an earlier calendar day as past', () => {
    expect(classifyDay(new Date(2026, 4, 20), today)).toBe('past');
    expect(classifyDay(new Date(2026, 4, 1), today)).toBe('past');
  });

  it('classifies the same calendar day as today regardless of time-of-day', () => {
    expect(classifyDay(new Date(2026, 4, 21), today)).toBe('today');
    // A bucket date at local midnight vs a `today` carrying a wall-clock
    // time must still land on 'today'.
    expect(classifyDay(new Date(2026, 4, 21), new Date(2026, 4, 21, 18, 30))).toBe('today');
    expect(classifyDay(new Date(2026, 4, 21, 23, 59), today)).toBe('today');
  });

  it('classifies a later calendar day as future', () => {
    expect(classifyDay(new Date(2026, 4, 22), today)).toBe('future');
    expect(classifyDay(new Date(2026, 11, 31), today)).toBe('future');
  });
});

describe('classifyDays', () => {
  it('assigns chronological 1-based day numbers independent of position', () => {
    const days: DayBucket[] = [
      { date: new Date(2026, 4, 19), segments: [] },
      { date: new Date(2026, 4, 21), segments: [] },
      { date: new Date(2026, 4, 23), segments: [] },
    ];
    const result = classifyDays(days, today);
    expect(result.map((d) => d.dayNumber)).toEqual([1, 2, 3]);
    expect(result.map((d) => d.position)).toEqual(['past', 'today', 'future']);
  });

  it('handles a trip entirely in the past', () => {
    const days: DayBucket[] = [
      { date: new Date(2026, 3, 1), segments: [] },
      { date: new Date(2026, 3, 2), segments: [] },
    ];
    const result = classifyDays(days, today);
    expect(result.every((d) => d.position === 'past')).toBe(true);
  });

  it('handles a trip entirely in the future', () => {
    const days: DayBucket[] = [
      { date: new Date(2026, 6, 1), segments: [] },
      { date: new Date(2026, 6, 2), segments: [] },
    ];
    const result = classifyDays(days, today);
    expect(result.every((d) => d.position === 'future')).toBe(true);
  });
});

describe('findDayKeyForSegment', () => {
  // Minimal day shape — `findDayKeyForSegment` only needs `key` and
  // `segments`, matching the `ItineraryDay` slice the itinerary passes.
  const days = [
    {
      key: '2026-05-19',
      segments: [makeSegment({ id: 'past-a' }), makeSegment({ id: 'past-b' })],
    },
    {
      key: '2026-05-21',
      segments: [makeSegment({ id: 'today-a' })],
    },
    {
      key: '2026-05-23',
      segments: [makeSegment({ id: 'future-a' })],
    },
  ];

  it('resolves the owning day key for a segment in a past day', () => {
    // This is the case the deep-link-into-collapsed-day fix relies on:
    // the Cmd+K palette links to a segment in a collapsed past day, and
    // the itinerary force-expands the day this lookup returns.
    expect(findDayKeyForSegment(days, 'past-b')).toBe('2026-05-19');
  });

  it('resolves the owning day key for segments in today and future days', () => {
    expect(findDayKeyForSegment(days, 'today-a')).toBe('2026-05-21');
    expect(findDayKeyForSegment(days, 'future-a')).toBe('2026-05-23');
  });

  it('returns null for a segment id that no day contains', () => {
    expect(findDayKeyForSegment(days, 'deleted-segment')).toBeNull();
  });

  it('returns null when there are no days', () => {
    expect(findDayKeyForSegment([], 'past-a')).toBeNull();
  });
});

describe('daysContainSegment', () => {
  // The single combined past group only needs a boolean — "is the
  // deep-linked segment somewhere in the past span?" — to decide
  // whether to force-expand the one collapsed group.
  const pastDays = [
    {
      segments: [makeSegment({ id: 'past-a' }), makeSegment({ id: 'past-b' })],
    },
    {
      segments: [makeSegment({ id: 'past-c' })],
    },
  ];

  it('returns true when a past day contains the segment', () => {
    expect(daysContainSegment(pastDays, 'past-a')).toBe(true);
    expect(daysContainSegment(pastDays, 'past-c')).toBe(true);
  });

  it('returns false when no past day contains the segment', () => {
    expect(daysContainSegment(pastDays, 'today-a')).toBe(false);
  });

  it('returns false when there are no past days', () => {
    expect(daysContainSegment([], 'past-a')).toBe(false);
  });
});

describe('summariseLocations', () => {
  it('returns null when no segment has a location', () => {
    expect(summariseLocations([makeSegment({}), makeSegment({ locationName: '  ' })])).toBeNull();
  });

  it('returns a single location name', () => {
    expect(summariseLocations([makeSegment({ locationName: 'Paris' })])).toBe('Paris');
  });

  it('joins up to two distinct locations in segment order', () => {
    const segments = [
      makeSegment({ id: 'a', locationName: 'Paris' }),
      makeSegment({ id: 'b', locationName: 'Versailles' }),
      makeSegment({ id: 'c', locationName: 'Giverny' }),
    ];
    expect(summariseLocations(segments)).toBe('Paris, Versailles');
  });

  it('de-duplicates repeated location names', () => {
    const segments = [
      makeSegment({ id: 'a', locationName: 'Paris' }),
      makeSegment({ id: 'b', locationName: 'Paris' }),
    ];
    expect(summariseLocations(segments)).toBe('Paris');
  });

  it('trims whitespace around location names', () => {
    expect(summariseLocations([makeSegment({ locationName: '  Kyoto  ' })])).toBe('Kyoto');
  });
});

describe('isOngoing', () => {
  // `today` is 21 May 2026 (local midnight) — see the module-level const.
  it('is true for a multi-day segment that started before today and ends later', () => {
    // The repro: a hotel running 19–23 May is keyed into the 19 May
    // bucket but is still a live stay on 21 May.
    expect(
      isOngoing({ startsAt: new Date(2026, 4, 19), endsAt: new Date(2026, 4, 23) }, today),
    ).toBe(true);
  });

  it('is true when the segment ends today (calendar-day boundary, inclusive)', () => {
    // Started earlier, ends on `today` — a check-out at any time on the
    // 21st still counts as ongoing because the comparison is day-level.
    expect(
      isOngoing({ startsAt: new Date(2026, 4, 19), endsAt: new Date(2026, 4, 21) }, today),
    ).toBe(true);
    expect(
      isOngoing({ startsAt: new Date(2026, 4, 19), endsAt: new Date(2026, 4, 21, 11, 0) }, today),
    ).toBe(true);
  });

  it('is false when the segment ended yesterday', () => {
    expect(
      isOngoing({ startsAt: new Date(2026, 4, 18), endsAt: new Date(2026, 4, 20) }, today),
    ).toBe(false);
  });

  it('is false when the segment starts today — its start must be before today', () => {
    // A segment that starts today is not "ongoing as of today" in the
    // collapse sense — it lives in today's bucket already, never past.
    expect(
      isOngoing({ startsAt: new Date(2026, 4, 21), endsAt: new Date(2026, 4, 23) }, today),
    ).toBe(false);
  });

  it('is false with no endsAt — an open-ended segment cannot span a range', () => {
    expect(isOngoing({ startsAt: new Date(2026, 4, 19), endsAt: null }, today)).toBe(false);
  });

  it('is false with no startsAt', () => {
    expect(isOngoing({ startsAt: null, endsAt: new Date(2026, 4, 23) }, today)).toBe(false);
  });
});

describe('splitCollapsedDays', () => {
  // Minimal ClassifiedDay factory — `splitCollapsedDays` reads only
  // `position` and `segments`, but the cast keeps the call sites honest.
  function makeDay(position: ClassifiedDay['position'], segments: Segment[] = []): ClassifiedDay {
    return { date: new Date(), dayNumber: 1, position, segments } as ClassifiedDay;
  }

  it('collapses every pre-today day when none holds an ongoing segment', () => {
    const days = [makeDay('past'), makeDay('past'), makeDay('today'), makeDay('future')];
    const { collapsed, visible } = splitCollapsedDays(days, today);
    expect(collapsed).toHaveLength(2);
    expect(visible.map((d) => d.position)).toEqual(['today', 'future']);
  });

  it('stops the collapsed run at a past day holding an ongoing segment', () => {
    // The repro: day 19 carries a hotel running 19–23 May. Days before
    // it collapse; day 19, the genuinely-past day 20, today and future
    // all stay visible — the contiguous live stretch.
    const ongoingHotel = makeSegment({
      id: 'hotel',
      type: 'hotel',
      startsAt: new Date(2026, 4, 19),
      endsAt: new Date(2026, 4, 23),
    });
    const days = [
      makeDay('past'), // 18 May — collapses
      makeDay('past', [ongoingHotel]), // 19 May — ongoing, stops the run
      makeDay('past'), // 20 May — genuinely past but inside the live stretch
      makeDay('today'),
      makeDay('future'),
    ];
    const { collapsed, visible } = splitCollapsedDays(days, today);
    expect(collapsed).toHaveLength(1);
    expect(visible).toHaveLength(4);
    expect(visible[0]!.segments[0]).toBe(ongoingHotel);
  });

  it('collapses nothing when the very first day holds an ongoing segment', () => {
    const ongoingHotel = makeSegment({
      id: 'hotel',
      startsAt: new Date(2026, 4, 19),
      endsAt: new Date(2026, 4, 23),
    });
    const days = [makeDay('past', [ongoingHotel]), makeDay('today'), makeDay('future')];
    const { collapsed, visible } = splitCollapsedDays(days, today);
    expect(collapsed).toHaveLength(0);
    expect(visible).toHaveLength(3);
  });

  it('collapses nothing when there are no past days', () => {
    const days = [makeDay('today'), makeDay('future')];
    const { collapsed, visible } = splitCollapsedDays(days, today);
    expect(collapsed).toHaveLength(0);
    expect(visible).toHaveLength(2);
  });

  it('collapses every day for a trip entirely in the past with no ongoing segments', () => {
    const days = [makeDay('past'), makeDay('past'), makeDay('past')];
    const { collapsed, visible } = splitCollapsedDays(days, today);
    expect(collapsed).toHaveLength(3);
    expect(visible).toHaveLength(0);
  });
});
