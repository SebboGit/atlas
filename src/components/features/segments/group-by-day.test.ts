import { describe, expect, it } from 'vitest';

import type { Segment } from '@/lib/segments';

import {
  countDaysInclusive,
  fillDayRange,
  groupSegmentsByDay,
  surfaceUndatedOnItinerary,
} from './group-by-day';

function makeSegment(overrides: Partial<Segment>): Segment {
  return {
    id: 's-1',
    type: 'note',
    tripId: 'trip-1',
    data: {},
    locationName: null,
    startsAt: null,
    endsAt: null,
    needsReview: false,
    ...overrides,
  } as unknown as Segment;
}

describe('surfaceUndatedOnItinerary', () => {
  it('surfaces note and transit — the types with no dedicated tab', () => {
    const note = makeSegment({ id: 'n', type: 'note' });
    const transit = makeSegment({ id: 't', type: 'transit' });

    const result = surfaceUndatedOnItinerary([note, transit]);

    expect(result).toEqual([note, transit]);
  });

  it('excludes activity and food — their undated state lives on their own tabs', () => {
    const activity = makeSegment({ id: 'a', type: 'activity' });
    const food = makeSegment({ id: 'f', type: 'food' });

    expect(surfaceUndatedOnItinerary([activity, food])).toEqual([]);
  });

  it('excludes flight and hotel', () => {
    const flight = makeSegment({ id: 'fl', type: 'flight' });
    const hotel = makeSegment({ id: 'h', type: 'hotel' });

    expect(surfaceUndatedOnItinerary([flight, hotel])).toEqual([]);
  });

  it('keeps only the surfaced types from a mixed list, preserving order', () => {
    const segments = [
      makeSegment({ id: 'a', type: 'activity' }),
      makeSegment({ id: 'n', type: 'note' }),
      makeSegment({ id: 'f', type: 'food' }),
      makeSegment({ id: 't', type: 'transit' }),
      makeSegment({ id: 'h', type: 'hotel' }),
    ];

    expect(surfaceUndatedOnItinerary(segments).map((s) => s.id)).toEqual(['n', 't']);
  });

  it('returns an empty array for an empty input', () => {
    expect(surfaceUndatedOnItinerary([])).toEqual([]);
  });
});

describe('groupSegmentsByDay — within-day ordering', () => {
  // All segments share one UTC day (20 Oct 2025) so they land in a single
  // bucket; the test asserts the order WITHIN that bucket.
  const utc = (h: number, m = 0) => new Date(Date.UTC(2025, 9, 20, h, m));
  const dateOnly = new Date(Date.UTC(2025, 9, 20, 0, 0));

  function orderedIds(segments: Segment[]): string[] {
    const { days } = groupSegmentsByDay(segments);
    expect(days).toHaveLength(1);
    return days[0]!.segments.map((s) => s.id);
  }

  it('sorts a timed flight before a date-only hotel check-in on the same day', () => {
    const hotel = makeSegment({ id: 'hotel', type: 'hotel', startsAt: dateOnly });
    const flight = makeSegment({ id: 'flight', type: 'flight', startsAt: utc(20) });
    // Input order puts the hotel first (its raw 00:00Z timestamp) — the
    // bug. The sort must correct it to flight → hotel.
    expect(orderedIds([hotel, flight])).toEqual(['flight', 'hotel']);
  });

  it('keeps a flight before a hotel even when the hotel sorts earlier by raw time', () => {
    // Flight departs 17:00, lands 20:00; a hotel carries a 12:00 check-in
    // instant (a legacy/timed row). Bound to the flight's landing, the
    // hotel still follows it — the user's "check-in 3pm, flight lands 8pm".
    const hotel = makeSegment({ id: 'hotel', type: 'hotel', startsAt: utc(12) });
    const flight = makeSegment({
      id: 'flight',
      type: 'flight',
      startsAt: utc(17),
      endsAt: utc(20),
    });
    expect(orderedIds([hotel, flight])).toEqual(['flight', 'hotel']);
  });

  it('leaves timed non-hotel segments in chronological order', () => {
    const flight = makeSegment({ id: 'flight', type: 'flight', startsAt: utc(8), endsAt: utc(10) });
    const activity = makeSegment({ id: 'activity', type: 'activity', startsAt: utc(14) });
    const hotel = makeSegment({ id: 'hotel', type: 'hotel', startsAt: dateOnly });
    // Flight lands 10:00; the hotel binds to 10:00; the activity stays 14:00.
    expect(orderedIds([activity, hotel, flight])).toEqual(['flight', 'hotel', 'activity']);
  });

  it('does not move a date-only hotel on a day with no flight', () => {
    // The minimal rule: only flights pull a hotel down. With no flight the
    // day stays chronological — the date-only hotel keeps its 00:00Z.
    const hotel = makeSegment({ id: 'hotel', type: 'hotel', startsAt: dateOnly });
    const activity = makeSegment({ id: 'activity', type: 'activity', startsAt: utc(9) });
    expect(orderedIds([activity, hotel])).toEqual(['hotel', 'activity']);
  });

  it('orders a hotel after every flight on a multi-flight day', () => {
    const f1 = makeSegment({ id: 'f1', type: 'flight', startsAt: utc(6), endsAt: utc(8) });
    const f2 = makeSegment({ id: 'f2', type: 'flight', startsAt: utc(14), endsAt: utc(17) });
    const hotel = makeSegment({ id: 'hotel', type: 'hotel', startsAt: dateOnly });
    expect(orderedIds([hotel, f1, f2])).toEqual(['f1', 'f2', 'hotel']);
  });

  it('breaks an exact-time tie by segment type (transit before activity before note)', () => {
    const note = makeSegment({ id: 'note', type: 'note', startsAt: utc(9) });
    const activity = makeSegment({ id: 'act', type: 'activity', startsAt: utc(9) });
    const transit = makeSegment({ id: 'tr', type: 'transit', startsAt: utc(9) });
    expect(orderedIds([note, activity, transit])).toEqual(['tr', 'act', 'note']);
  });
});

describe('fillDayRange', () => {
  // The motivating bug: a trip 1–5 Jun with only a check-in on the 1st
  // and a return flight on the 5th rendered "Day 1, Day 2" — the filled
  // list must read Day 1…Day 5.
  const utcDay = (m: number, d: number) => new Date(Date.UTC(2026, m, d));

  function bucketsFor(segments: Segment[]) {
    return groupSegmentsByDay(segments).days;
  }

  it('fills the gap days between segment-dated buckets', () => {
    const days = bucketsFor([
      makeSegment({ id: 'hotel', type: 'hotel', startsAt: utcDay(5, 1), endsAt: utcDay(5, 5) }),
      makeSegment({ id: 'flight', type: 'flight', startsAt: utcDay(5, 5) }),
    ]);
    const filled = fillDayRange(days);
    expect(filled.map((d) => d.key)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ]);
    // Existing buckets are reused, gap days are empty.
    expect(filled[0]!.segments.map((s) => s.id)).toEqual(['hotel']);
    expect(filled[1]!.segments).toEqual([]);
    expect(filled[4]!.segments.map((s) => s.id)).toEqual(['flight']);
  });

  it('extends the range to the trip dates when they reach further', () => {
    const days = bucketsFor([makeSegment({ id: 'act', startsAt: utcDay(5, 3) })]);
    const filled = fillDayRange(days, { start: utcDay(5, 1), end: utcDay(5, 5) });
    expect(filled.map((d) => d.key)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ]);
  });

  it('extends the range to a stay running past the last dated bucket', () => {
    // Undated trip, single hotel 1–4 Jun: the check-out day must exist
    // even though no bucket and no trip date reaches it.
    const days = bucketsFor([
      makeSegment({ id: 'hotel', type: 'hotel', startsAt: utcDay(5, 1), endsAt: utcDay(5, 4) }),
    ]);
    const filled = fillDayRange(days);
    expect(filled.map((d) => d.key)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
    ]);
  });

  it('gives every filled day a local-midnight date matching its key', () => {
    const days = bucketsFor([
      makeSegment({ id: 'hotel', type: 'hotel', startsAt: utcDay(5, 1), endsAt: utcDay(5, 3) }),
    ]);
    const gap = fillDayRange(days)[1]!;
    expect(gap.key).toBe('2026-06-02');
    // Local getters read the same calendar day the key names — the same
    // contract groupSegmentsByDay documents for its own buckets.
    expect(gap.date.getFullYear()).toBe(2026);
    expect(gap.date.getMonth()).toBe(5);
    expect(gap.date.getDate()).toBe(2);
    expect(gap.date.getHours()).toBe(0);
  });

  it('returns [] for no buckets — an empty itinerary keeps its empty state', () => {
    expect(fillDayRange([], { start: utcDay(5, 1), end: utcDay(5, 5) })).toEqual([]);
  });

  it('skips the fill past a year of days (pathological dates degrade gracefully)', () => {
    const days = bucketsFor([
      makeSegment({ id: 'a', startsAt: utcDay(5, 1) }),
      // A typo'd year: 2027 instead of 2026.
      makeSegment({ id: 'b', startsAt: new Date(Date.UTC(2027, 7, 1)) }),
    ]);
    expect(fillDayRange(days)).toHaveLength(2);
  });
});

describe('countDaysInclusive', () => {
  const utcDay = (m: number, d: number) => new Date(Date.UTC(2026, m, d));

  it('counts both endpoints', () => {
    expect(countDaysInclusive(utcDay(5, 1), utcDay(5, 5))).toBe(5);
    expect(countDaysInclusive(utcDay(5, 1), utcDay(5, 1))).toBe(1);
  });

  it('is null when either end is missing or the range is inverted', () => {
    expect(countDaysInclusive(null, utcDay(5, 5))).toBeNull();
    expect(countDaysInclusive(utcDay(5, 1), null)).toBeNull();
    expect(countDaysInclusive(utcDay(5, 5), utcDay(5, 1))).toBeNull();
  });
});
