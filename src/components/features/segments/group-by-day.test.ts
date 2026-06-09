import { describe, expect, it } from 'vitest';

import type { Segment } from '@/lib/segments';

import { surfaceUndatedOnItinerary } from './group-by-day';

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
