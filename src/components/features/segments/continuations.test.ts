import { describe, expect, it } from 'vitest';

import type { Segment } from '@/lib/segments';

import {
  continuationCheckOutTime,
  continuationName,
  continuationPill,
  continuationsByDayKey,
} from './continuations';
import type { ItineraryDay } from './itinerary-day-list';

function makeSegment(overrides: Partial<Segment>): Segment {
  return {
    id: 's-1',
    type: 'activity',
    tripId: 'trip-1',
    data: {},
    locationName: null,
    startsAt: null,
    endsAt: null,
    needsReview: false,
    ...overrides,
  } as unknown as Segment;
}

// `YYYY-MM-DD` token, matching what the page serialises via `dayKey`.
function key(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function makeDay(overrides: Partial<ItineraryDay> & Pick<ItineraryDay, 'position'>): ItineraryDay {
  const k = overrides.key ?? overrides.dateKey ?? key(2026, 5, 30);
  return {
    key: k,
    dateKey: k,
    dayNumber: 1,
    segments: [],
    ...overrides,
  };
}

describe('continuationsByDayKey', () => {
  // A hotel 28 May–1 Jun. The stay surfaces on EVERY day it spans after
  // check-in — the itinerary renders the trip's full calendar, so a
  // mid-stay day with nothing scheduled still reads "staying". Position
  // plays no part (clock-free): past, today, and future spanned days all
  // carry the row; only the check-in day itself never does.
  // UTC instants (the real validator shape) — the gating is UTC-token
  // math, so the fixtures must be too or they'd skew on a non-UTC runner.
  const hotel = makeSegment({
    id: 'hotel-1',
    type: 'hotel',
    data: { propertyName: 'Hotel Sakura' },
    startsAt: new Date(Date.UTC(2026, 4, 28)),
    endsAt: new Date(Date.UTC(2026, 5, 1)),
  });

  it('surfaces an ongoing stay on every day it spans, not its check-in day', () => {
    const days: ItineraryDay[] = [
      makeDay({
        key: key(2026, 5, 28),
        dateKey: key(2026, 5, 28),
        position: 'past',
        segments: [hotel],
      }),
      makeDay({
        key: key(2026, 5, 29),
        dateKey: key(2026, 5, 29),
        position: 'past',
        segments: [makeSegment({ id: 'hike', startsAt: new Date(Date.UTC(2026, 4, 29)) })],
      }),
      makeDay({ key: key(2026, 5, 30), dateKey: key(2026, 5, 30), position: 'today' }),
      makeDay({ key: key(2026, 5, 31), dateKey: key(2026, 5, 31), position: 'future' }),
      makeDay({ key: key(2026, 6, 1), dateKey: key(2026, 6, 1), position: 'future' }),
    ];

    const result = continuationsByDayKey(days);

    // Present on every spanned day — the past day with its own segments,
    // today, both future days through check-out.
    expect(result.get(key(2026, 5, 29))?.map((s) => s.id)).toEqual(['hotel-1']);
    expect(result.get(key(2026, 5, 30))?.map((s) => s.id)).toEqual(['hotel-1']);
    expect(result.get(key(2026, 5, 31))?.map((s) => s.id)).toEqual(['hotel-1']);
    expect(result.get(key(2026, 6, 1))?.map((s) => s.id)).toEqual(['hotel-1']);
    // Never on its own check-in day — that's the full card's home.
    expect(result.has(key(2026, 5, 28))).toBe(false);
  });

  it('does not surface a stay on days after its check-out', () => {
    // Same hotel checks out 1 Jun; a 2 Jun future day must carry nothing.
    const days: ItineraryDay[] = [
      makeDay({
        key: key(2026, 5, 28),
        dateKey: key(2026, 5, 28),
        position: 'past',
        segments: [hotel],
      }),
      makeDay({ key: key(2026, 5, 30), dateKey: key(2026, 5, 30), position: 'today' }),
      makeDay({ key: key(2026, 6, 2), dateKey: key(2026, 6, 2), position: 'future' }),
    ];
    const result = continuationsByDayKey(days);
    expect(result.get(key(2026, 5, 30))?.map((s) => s.id)).toEqual(['hotel-1']);
    expect(result.has(key(2026, 6, 2))).toBe(false);
  });

  it('surfaces a stay checking in today on the later days it spans', () => {
    // Check-in day shows the full card (no continuation); tomorrow is
    // mid-stay, so it carries the row — without it a segment-less
    // tomorrow would wrongly read as a blank day.
    const todayHotel = makeSegment({
      id: 'hotel-today',
      type: 'hotel',
      data: { propertyName: 'Today Inn' },
      startsAt: new Date(Date.UTC(2026, 4, 30)),
      endsAt: new Date(Date.UTC(2026, 5, 2)),
    });
    const days: ItineraryDay[] = [
      makeDay({
        key: key(2026, 5, 30),
        dateKey: key(2026, 5, 30),
        position: 'today',
        segments: [todayHotel],
      }),
      makeDay({ key: key(2026, 5, 31), dateKey: key(2026, 5, 31), position: 'future' }),
    ];
    const result = continuationsByDayKey(days);
    // Not a continuation on its own check-in day…
    expect(result.has(key(2026, 5, 30))).toBe(false);
    // …but present on the next day it spans.
    expect(result.get(key(2026, 5, 31))?.map((s) => s.id)).toEqual(['hotel-today']);
  });

  it('ignores single-day and open-ended segments', () => {
    const singleDay = makeSegment({
      id: 'act-1',
      type: 'activity',
      startsAt: new Date(Date.UTC(2026, 4, 28)),
      endsAt: null,
    });
    const days: ItineraryDay[] = [
      makeDay({
        key: key(2026, 5, 28),
        dateKey: key(2026, 5, 28),
        position: 'past',
        segments: [singleDay],
      }),
      makeDay({ key: key(2026, 5, 30), dateKey: key(2026, 5, 30), position: 'today' }),
    ];
    expect(continuationsByDayKey(days).size).toBe(0);
  });

  it('returns an empty map when no segment spans multiple days', () => {
    const days: ItineraryDay[] = [
      makeDay({ key: key(2026, 5, 30), dateKey: key(2026, 5, 30), position: 'today' }),
      makeDay({ key: key(2026, 5, 31), dateKey: key(2026, 5, 31), position: 'future' }),
    ];
    expect(continuationsByDayKey(days).size).toBe(0);
  });
});

describe('continuationName', () => {
  it('uses the hotel property name', () => {
    expect(
      continuationName(makeSegment({ type: 'hotel', data: { propertyName: 'Hotel Sakura' } })),
    ).toBe('Hotel Sakura');
  });

  it('uses the activity title', () => {
    expect(
      continuationName(makeSegment({ type: 'activity', data: { title: 'Torres Trek' } })),
    ).toBe('Torres Trek');
  });

  it('joins transit endpoints with an arrow', () => {
    expect(
      continuationName(
        makeSegment({
          type: 'transit',
          data: { mode: 'train', fromName: 'Tokyo', toName: 'Kyoto' },
        }),
      ),
    ).toBe('Tokyo → Kyoto');
  });

  it('falls back to a type label when data is unparseable', () => {
    expect(continuationName(makeSegment({ type: 'hotel', data: {} }))).toBe('Hotel');
  });
});

describe('continuationPill', () => {
  it('keeps the stay language for hotels', () => {
    expect(continuationPill('hotel')).toBe('Staying');
  });

  it('reads "Ongoing" for every other span-capable type', () => {
    expect(continuationPill('activity')).toBe('Ongoing');
    expect(continuationPill('transit')).toBe('Ongoing');
    expect(continuationPill('flight')).toBe('Ongoing');
  });

  it('stays total over types that never span days', () => {
    expect(continuationPill('food')).toBe('Ongoing');
    expect(continuationPill('note')).toBe('Ongoing');
  });
});

describe('continuationCheckOutTime', () => {
  // UTC endpoints so the day-key match is deterministic on any runner tz.
  const checkOut = key(2026, 6, 1);
  const hotel = makeSegment({
    type: 'hotel',
    data: { propertyName: 'Hotel Sakura', checkOutTime: '11:00' },
    startsAt: new Date(Date.UTC(2026, 4, 28)),
    endsAt: new Date(Date.UTC(2026, 5, 1)),
  });

  it("returns the check-out time on the stay's final day", () => {
    expect(continuationCheckOutTime(hotel, checkOut)).toBe('11:00');
  });

  it('returns null on every earlier continuation day', () => {
    expect(continuationCheckOutTime(hotel, key(2026, 5, 30))).toBeNull();
    expect(continuationCheckOutTime(hotel, key(2026, 5, 31))).toBeNull();
  });

  it('returns null when the hotel carries no check-out time', () => {
    const noTime = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel Sakura' },
      startsAt: new Date(Date.UTC(2026, 4, 28)),
      endsAt: new Date(Date.UTC(2026, 5, 1)),
    });
    expect(continuationCheckOutTime(noTime, checkOut)).toBeNull();
  });

  it('returns null for a non-hotel span even with a check-out time in data', () => {
    const transit = makeSegment({
      type: 'transit',
      data: { mode: 'train', checkOutTime: '11:00' },
      startsAt: new Date(Date.UTC(2026, 4, 28)),
      endsAt: new Date(Date.UTC(2026, 5, 1)),
    });
    expect(continuationCheckOutTime(transit, checkOut)).toBeNull();
  });

  it('returns null for an open-ended stay (no check-out date)', () => {
    const openEnded = makeSegment({
      type: 'hotel',
      data: { propertyName: 'Hotel Sakura', checkOutTime: '11:00' },
      startsAt: new Date(Date.UTC(2026, 4, 28)),
      endsAt: null,
    });
    expect(continuationCheckOutTime(openEnded, checkOut)).toBeNull();
  });
});
