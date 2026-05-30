import { describe, expect, it } from 'vitest';

import type { Segment } from '@/lib/segments';

import {
  classifyDay,
  classifyDays,
  continuesThroughDay,
  daysContainSegment,
  findDayKeyForSegment,
  isOngoing,
  ongoingContinuationsByDayKey,
  splitCollapsedDays,
  type ClassifiedDay,
} from './day-temporal';
import { dayKey, type DayBucket } from './group-by-day';

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
  // `splitCollapsedDays` reads only `position` now (past collapses
  // unconditionally — ongoing stays surface as continuations instead).
  function makeDay(position: ClassifiedDay['position']): ClassifiedDay {
    return { date: new Date(), dayNumber: 1, position, segments: [] } as ClassifiedDay;
  }

  it('collapses every leading past day', () => {
    const days = [makeDay('past'), makeDay('past'), makeDay('today'), makeDay('future')];
    const { collapsed, visible } = splitCollapsedDays(days);
    expect(collapsed).toHaveLength(2);
    expect(visible.map((d) => d.position)).toEqual(['today', 'future']);
  });

  it('collapses a past day even when it holds an ongoing multi-day segment', () => {
    // Was the old exception: a hotel running over a past day used to keep
    // it (and every later past day) expanded. Now ALL past days collapse;
    // the stay re-surfaces as a continuation under today (see
    // ongoingContinuationsByDayKey).
    const days = [
      makeDay('past'),
      makeDay('past'),
      makeDay('past'),
      makeDay('today'),
      makeDay('future'),
    ];
    const { collapsed, visible } = splitCollapsedDays(days);
    expect(collapsed).toHaveLength(3);
    expect(visible.map((d) => d.position)).toEqual(['today', 'future']);
  });

  it('collapses nothing when there are no past days', () => {
    const { collapsed, visible } = splitCollapsedDays([makeDay('today'), makeDay('future')]);
    expect(collapsed).toHaveLength(0);
    expect(visible).toHaveLength(2);
  });

  it('collapses every day for a trip entirely in the past', () => {
    const { collapsed, visible } = splitCollapsedDays([
      makeDay('past'),
      makeDay('past'),
      makeDay('past'),
    ]);
    expect(collapsed).toHaveLength(3);
    expect(visible).toHaveLength(0);
  });
});

describe('continuesThroughDay', () => {
  const hotel = { startsAt: new Date(2026, 4, 28), endsAt: new Date(2026, 5, 1) }; // 28 May – 1 Jun

  it('is true for a day strictly after check-in, up to and incl. check-out', () => {
    expect(continuesThroughDay(hotel, new Date(2026, 4, 30))).toBe(true); // 30 May
    expect(continuesThroughDay(hotel, new Date(2026, 5, 1))).toBe(true); // 1 Jun (check-out)
  });

  it('is false on the check-in day itself and after check-out', () => {
    expect(continuesThroughDay(hotel, new Date(2026, 4, 28))).toBe(false); // check-in
    expect(continuesThroughDay(hotel, new Date(2026, 5, 2))).toBe(false); // after check-out
  });

  it('is false for single-day / open-ended segments', () => {
    expect(
      continuesThroughDay({ startsAt: new Date(2026, 4, 28), endsAt: null }, new Date(2026, 4, 30)),
    ).toBe(false);
  });
});

describe('ongoingContinuationsByDayKey', () => {
  function day(d: number, position: ClassifiedDay['position'], segments: Segment[]): ClassifiedDay {
    // May = month 4; days within May for simplicity, June where noted.
    return { date: new Date(2026, 4, d), dayNumber: d, position, segments } as ClassifiedDay;
  }

  it('surfaces an ongoing stay on today + future spanned days only', () => {
    const hotel = makeSegment({
      id: 'hotel',
      type: 'hotel',
      startsAt: new Date(2026, 4, 28),
      endsAt: new Date(2026, 4, 31),
    });
    const days = [
      day(27, 'past', [
        makeSegment({ id: 'flight', type: 'flight', startsAt: new Date(2026, 4, 27) }),
      ]),
      day(28, 'past', [hotel]),
      day(29, 'past', [makeSegment({ id: 'hike', startsAt: new Date(2026, 4, 29) })]),
      day(30, 'today', [makeSegment({ id: 'act', startsAt: new Date(2026, 4, 30) })]),
      day(31, 'future', [
        makeSegment({ id: 'ferry', type: 'transit', startsAt: new Date(2026, 4, 31) }),
      ]),
    ];

    const conts = ongoingContinuationsByDayKey(days);

    // Surfaced under today + the future spanned day…
    expect(conts.get(dayKey(new Date(2026, 4, 30)))).toEqual([hotel]);
    expect(conts.get(dayKey(new Date(2026, 4, 31)))).toEqual([hotel]);
    // …never on its own check-in day or any collapsed past day.
    expect(conts.has(dayKey(new Date(2026, 4, 28)))).toBe(false);
    expect(conts.has(dayKey(new Date(2026, 4, 29)))).toBe(false);
  });

  it('emits nothing for a stay that checks in today (a normal same-day card)', () => {
    const hotel = makeSegment({
      id: 'hotel',
      type: 'hotel',
      startsAt: new Date(2026, 4, 30),
      endsAt: new Date(2026, 5, 2),
    });
    const days = [day(30, 'today', [hotel]), day(31, 'future', [])];
    expect(ongoingContinuationsByDayKey(days).size).toBe(0);
  });

  it('emits nothing when there are no past days', () => {
    const days = [day(30, 'today', []), day(31, 'future', [])];
    expect(ongoingContinuationsByDayKey(days).size).toBe(0);
  });
});
