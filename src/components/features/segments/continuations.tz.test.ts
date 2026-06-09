// Forces a west-of-UTC timezone for THIS WHOLE FILE, before any date math,
// so the continuation gating + check-out match are exercised off-UTC. The
// rows are part of the SSR'd markup now (computed on the server AND the
// client), so the contract is INVARIANCE: an off-UTC viewer must derive
// exactly the rows and check-out day a UTC server rendered, or hydration
// mismatches. Both sides are pure UTC-day-token math (`continuesThroughDay`
// via `dayKey`), and this file pins that under a skewed local clock.
// Mirrors the ADR-0014 lesson: TZ-dependent rendering needs a non-UTC check.
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

describe('continuations — off-UTC invariance', () => {
  it('derives the same rows and check-out day a UTC server renders', () => {
    // Sanity: confirm the forced tz is in effect — `00:00Z` is the PRIOR
    // local day here, the skew that local-getter math would leak into the
    // markup.
    expect(new Date(Date.UTC(2026, 5, 1)).getDate()).toBe(31);

    // Date-only hotel: endpoints at `00:00Z`, the real validator's shape
    // (a `YYYY-MM-DD` pick → UTC midnight). Checks in 28 May, out 1 Jun.
    const hotel = makeSegment({
      id: 'hotel-out',
      type: 'hotel',
      data: { propertyName: 'Hotel Sakura', checkOutTime: '11:00' },
      startsAt: new Date(Date.UTC(2026, 4, 28)),
      endsAt: new Date(Date.UTC(2026, 5, 1)),
    });

    // The filled calendar (fillDayRange extends through the latest
    // endsAt), so the UTC check-out day is always a rendered day.
    const days: ItineraryDay[] = [
      makeDay({ key: '2026-05-28', position: 'past', segments: [hotel] }),
      makeDay({ key: '2026-05-29', position: 'past' }),
      makeDay({ key: '2026-05-30', position: 'today' }),
      makeDay({ key: '2026-05-31', position: 'future' }),
      makeDay({ key: '2026-06-01', position: 'future' }),
    ];

    const conts = continuationsByDayKey(days);
    const rendered = days.filter((d) => conts.has(d.key)).map((d) => d.key);
    // Exactly what a UTC server produces: every spanned day after
    // check-in, through the UTC check-out day.
    expect(rendered).toEqual(['2026-05-29', '2026-05-30', '2026-05-31', '2026-06-01']);

    // Check-out time shows on the UTC check-out day and nowhere earlier.
    expect(continuationCheckOutTime(hotel, '2026-06-01')).toBe('11:00');
    for (const earlier of rendered.slice(0, -1)) {
      expect(continuationCheckOutTime(hotel, earlier)).toBeNull();
    }
  });
});
