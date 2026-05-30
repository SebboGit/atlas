import { describe, expect, it } from 'vitest';

import type { TripMapArc, TripMapPin } from '@/lib/trip-map/repo';

import {
  dayKeyForSegment,
  focusPointForItem,
  indexMapGeometry,
  mappableSegmentIds,
  pointsForDay,
  pointsForItem,
  type RailDay,
  type RailItem,
} from './timeline-model';

function pin(overrides: Partial<TripMapPin> & { segmentId: string }): TripMapPin {
  return {
    kind: 'hotel',
    label: 'Somewhere',
    country: 'JP',
    lat: 35,
    lng: 139,
    date: null,
    ...overrides,
  };
}

function arc(overrides: Partial<TripMapArc> & { segmentId: string }): TripMapArc {
  return {
    originLat: 51.47,
    originLng: -0.45,
    destLat: 35.55,
    destLng: 139.78,
    originCountry: 'GB',
    destCountry: 'JP',
    ...overrides,
  };
}

function item(overrides: Partial<RailItem> & { segmentId: string }): RailItem {
  return {
    icon: 'hotel',
    label: 'Row',
    timeLabel: null,
    country: 'JP',
    mapKind: 'pin',
    ...overrides,
  };
}

function day(overrides: Partial<RailDay> & { items: RailItem[] }): RailDay {
  return {
    key: '2025-10-05',
    dateKey: '2025-10-05',
    dayNumber: 1,
    position: 'today',
    spans: overrides.items.map(() => ({ startsAt: null, endsAt: null })),
    ...overrides,
  };
}

describe('indexMapGeometry', () => {
  it('keeps the first pin per segment id (flight origin+dest share an id)', () => {
    const idx = indexMapGeometry(
      [
        pin({ segmentId: 'f1', label: 'HND', lat: 1 }),
        pin({ segmentId: 'f1', label: 'LHR', lat: 2 }),
      ],
      [],
    );
    expect(idx.pinBySegmentId.size).toBe(1);
    expect(idx.pinBySegmentId.get('f1')?.label).toBe('HND');
  });

  it('indexes arcs by segment id', () => {
    const idx = indexMapGeometry([], [arc({ segmentId: 'f1' })]);
    expect(idx.arcBySegmentId.get('f1')?.destCountry).toBe('JP');
  });
});

describe('pointsForItem', () => {
  it('yields both endpoints for an arc item', () => {
    const idx = indexMapGeometry([], [arc({ segmentId: 'f1' })]);
    const pts = pointsForItem(item({ segmentId: 'f1', mapKind: 'arc' }), idx);
    expect(pts).toEqual([
      { lat: 51.47, lng: -0.45 },
      { lat: 35.55, lng: 139.78 },
    ]);
  });

  it('yields one point for a pin item', () => {
    const idx = indexMapGeometry([pin({ segmentId: 'h1', lat: 35.69, lng: 139.75 })], []);
    expect(pointsForItem(item({ segmentId: 'h1', mapKind: 'pin' }), idx)).toEqual([
      { lat: 35.69, lng: 139.75 },
    ]);
  });

  it('yields nothing for a none item', () => {
    const idx = indexMapGeometry([], []);
    expect(pointsForItem(item({ segmentId: 'n1', mapKind: 'none' }), idx)).toEqual([]);
  });

  it('yields nothing when geometry is missing for the id', () => {
    const idx = indexMapGeometry([], []);
    expect(pointsForItem(item({ segmentId: 'gone', mapKind: 'pin' }), idx)).toEqual([]);
    expect(pointsForItem(item({ segmentId: 'gone', mapKind: 'arc' }), idx)).toEqual([]);
  });
});

describe('focusPointForItem', () => {
  it('focuses an arc on its destination endpoint', () => {
    const idx = indexMapGeometry([], [arc({ segmentId: 'f1' })]);
    expect(focusPointForItem(item({ segmentId: 'f1', mapKind: 'arc' }), idx)).toEqual({
      lat: 35.55,
      lng: 139.78,
    });
  });

  it('focuses a pin on itself', () => {
    const idx = indexMapGeometry([pin({ segmentId: 'h1', lat: 1, lng: 2 })], []);
    expect(focusPointForItem(item({ segmentId: 'h1', mapKind: 'pin' }), idx)).toEqual({
      lat: 1,
      lng: 2,
    });
  });

  it('returns null for a none item', () => {
    expect(
      focusPointForItem(item({ segmentId: 'n1', mapKind: 'none' }), indexMapGeometry([], [])),
    ).toBeNull();
  });
});

describe('mappableSegmentIds', () => {
  it('excludes none items', () => {
    const d = day({
      items: [
        item({ segmentId: 'a', mapKind: 'pin' }),
        item({ segmentId: 'b', mapKind: 'arc' }),
        item({ segmentId: 'c', mapKind: 'none' }),
      ],
    });
    expect(mappableSegmentIds(d)).toEqual(['a', 'b']);
  });
});

describe('pointsForDay', () => {
  it('flattens every mappable item point for the day', () => {
    const idx = indexMapGeometry(
      [pin({ segmentId: 'h1', lat: 35.69, lng: 139.75 })],
      [arc({ segmentId: 'f1' })],
    );
    const d = day({
      items: [
        item({ segmentId: 'h1', mapKind: 'pin' }),
        item({ segmentId: 'f1', mapKind: 'arc' }),
        item({ segmentId: 'n1', mapKind: 'none' }),
      ],
    });
    expect(pointsForDay(d, idx)).toEqual([
      { lat: 35.69, lng: 139.75 },
      { lat: 51.47, lng: -0.45 },
      { lat: 35.55, lng: 139.78 },
    ]);
  });
});

describe('dayKeyForSegment', () => {
  const days: RailDay[] = [
    day({
      key: '2025-10-05',
      dateKey: '2025-10-05',
      dayNumber: 1,
      position: 'past',
      items: [item({ segmentId: 'a' }), item({ segmentId: 'b' })],
    }),
    day({
      key: '2025-10-06',
      dateKey: '2025-10-06',
      dayNumber: 2,
      position: 'today',
      items: [item({ segmentId: 'c' })],
    }),
  ];

  it('finds the owning day key', () => {
    expect(dayKeyForSegment(days, 'c')).toBe('2025-10-06');
    expect(dayKeyForSegment(days, 'a')).toBe('2025-10-05');
  });

  it('returns null for an unknown id (e.g. a wishlist-overlay pin)', () => {
    expect(dayKeyForSegment(days, 'wishlist-x')).toBeNull();
  });
});
