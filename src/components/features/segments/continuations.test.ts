import { describe, expect, it } from 'vitest';

import type { Segment } from '@/lib/segments';

import { continuationName, continuationsByDayKey } from './continuations';
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
  // The motivating bug: a hotel 28 May–1 Jun, today 30 May. Check-in day
  // (28) is past/collapsed; the stay should surface on today (30) and the
  // future days it spans (31, 1 Jun), but NOT on its own check-in day.
  const hotel = makeSegment({
    id: 'hotel-1',
    type: 'hotel',
    data: { propertyName: 'Hotel Sakura' },
    startsAt: new Date(2026, 4, 28),
    endsAt: new Date(2026, 5, 1),
  });

  it('surfaces an ongoing stay on today + the future days it spans, not its check-in day', () => {
    const days: ItineraryDay[] = [
      makeDay({
        key: key(2026, 5, 28),
        dateKey: key(2026, 5, 28),
        position: 'past',
        segments: [hotel],
      }),
      // A fully-concluded past single-day event — must NOT keep it visible.
      makeDay({
        key: key(2026, 5, 29),
        dateKey: key(2026, 5, 29),
        position: 'past',
        segments: [makeSegment({ id: 'hike', startsAt: new Date(2026, 4, 29) })],
      }),
      makeDay({ key: key(2026, 5, 30), dateKey: key(2026, 5, 30), position: 'today' }),
      makeDay({ key: key(2026, 5, 31), dateKey: key(2026, 5, 31), position: 'future' }),
      makeDay({ key: key(2026, 6, 1), dateKey: key(2026, 6, 1), position: 'future' }),
    ];

    const result = continuationsByDayKey(days);

    // Present on today and both spanned future days.
    expect(result.get(key(2026, 5, 30))?.map((s) => s.id)).toEqual(['hotel-1']);
    expect(result.get(key(2026, 5, 31))?.map((s) => s.id)).toEqual(['hotel-1']);
    expect(result.get(key(2026, 6, 1))?.map((s) => s.id)).toEqual(['hotel-1']);
    // Never on its own (collapsed) check-in day, nor on any past day.
    expect(result.has(key(2026, 5, 28))).toBe(false);
    expect(result.has(key(2026, 5, 29))).toBe(false);
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

  it('does not treat a stay checking in TODAY as a continuation', () => {
    // startsAt == today's day → its check-in day is `today`, not `past`,
    // so it is a normal same-day card, never a continuation.
    const todayHotel = makeSegment({
      id: 'hotel-today',
      type: 'hotel',
      data: { propertyName: 'Today Inn' },
      startsAt: new Date(2026, 4, 30),
      endsAt: new Date(2026, 5, 2),
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
    // Not a continuation on its own check-in (today) day.
    expect(result.has(key(2026, 5, 30))).toBe(false);
    // It DOES continue onto the next day — check-in bucket is `today`,
    // not `past`, so it's still not surfaced (only collapsed-check-in
    // stays become continuations).
    expect(result.has(key(2026, 5, 31))).toBe(false);
  });

  it('ignores single-day and open-ended segments in past buckets', () => {
    const singleDay = makeSegment({
      id: 'act-1',
      type: 'activity',
      startsAt: new Date(2026, 4, 28),
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

  it('returns an empty map when nothing is in a collapsed bucket', () => {
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
