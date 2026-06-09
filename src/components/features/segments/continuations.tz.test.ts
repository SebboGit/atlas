// Forces a west-of-UTC timezone for THIS WHOLE FILE, before any date math,
// so the check-out-day match is exercised off-UTC. CI runs in UTC and would
// otherwise never see this class of skew: a date-only hotel's `endsAt` is
// `00:00Z`, whose LOCAL day sits a day earlier west of UTC, so the last
// continuation row renders on a different token than the UTC day of
// `endsAt`. `continuationCheckOutTime` must match on the local-day basis the
// row gating uses, or the check-out time vanishes entirely. Mirrors the
// ADR-0014 lesson: TZ-dependent rendering needs a non-UTC check.
process.env.TZ = 'America/Los_Angeles';

import { describe, expect, it } from 'vitest';

import type { Segment } from '@/lib/segments';

import { continuationCheckOutTime, continuationsByDayKey } from './continuations';
import type { ItineraryDay } from './itinerary-day-list';

function makeSegment(overrides: Partial<Segment>): Segment {
  return {
    id: 's-1',
    type: 'hotel',
    tripId: 'trip-1',
    data: {},
    locationName: null,
    startsAt: null,
    endsAt: null,
    needsReview: false,
    ...overrides,
  } as unknown as Segment;
}

function key(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function makeDay(
  overrides: Partial<ItineraryDay> & Pick<ItineraryDay, 'key' | 'position'>,
): ItineraryDay {
  return {
    dateKey: overrides.key,
    dayNumber: 1,
    segments: [],
    ...overrides,
  };
}

describe('continuationCheckOutTime — off-UTC integration', () => {
  it('lands the check-out time on the last day the stay actually renders', () => {
    // Sanity: confirm the forced tz is in effect — `00:00Z` is the PRIOR
    // local day here, the exact condition that used to drop the time.
    expect(new Date(Date.UTC(2026, 5, 1)).getDate()).toBe(31);

    // Date-only hotel: `endsAt` at `00:00Z`, the real validator's shape
    // (a `YYYY-MM-DD` pick → UTC midnight). Checks in 28 May, out 1 Jun.
    const hotel = makeSegment({
      id: 'hotel-out',
      type: 'hotel',
      data: { propertyName: 'Hotel Sakura', checkOutTime: '11:00' },
      startsAt: new Date(Date.UTC(2026, 4, 28)),
      endsAt: new Date(Date.UTC(2026, 5, 1)),
    });

    const days: ItineraryDay[] = [
      makeDay({ key: key(2026, 5, 28), position: 'past', segments: [hotel] }),
      makeDay({ key: key(2026, 5, 30), position: 'today' }),
      makeDay({ key: key(2026, 5, 31), position: 'future' }),
      makeDay({ key: key(2026, 6, 1), position: 'future' }),
    ];

    // The days the stay actually renders a continuation on, in order.
    const conts = continuationsByDayKey(days);
    const rendered = days.filter((d) => conts.has(d.key)).map((d) => d.key);
    expect(rendered.length).toBeGreaterThan(0);

    const last = rendered[rendered.length - 1]!;
    // Check-out time shows on the last rendered day...
    expect(continuationCheckOutTime(hotel, last)).toBe('11:00');
    // ...and on no earlier day. (Under the old UTC match this returned null
    // on `last` too — the time disappeared off-UTC.)
    for (const earlier of rendered.slice(0, -1)) {
      expect(continuationCheckOutTime(hotel, earlier)).toBeNull();
    }
  });
});
