import { describe, expect, it } from 'vitest';

import type { TripMapArc, TripMapPin } from '@/lib/trip-map/repo';

import {
  indexMapGeometry,
  isArcDimmed,
  isPinDimmed,
  mappableSegmentIds,
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
    locationName: null,
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

  it('is empty for a day with nothing mappable', () => {
    const d = day({ items: [item({ segmentId: 'n1', mapKind: 'none' })] });
    expect(mappableSegmentIds(d)).toEqual([]);
  });
});

describe('isPinDimmed (country × day-highlight composition)', () => {
  const jpPin = pin({ segmentId: 's1', country: 'JP' });

  it('is not dimmed when no country and no day highlight are active', () => {
    expect(isPinDimmed(jpPin, null, null)).toBe(false);
  });

  it('dims a pin outside the active country', () => {
    expect(isPinDimmed(jpPin, 'FR', null)).toBe(true);
    expect(isPinDimmed(jpPin, 'JP', null)).toBe(false);
  });

  it('dims a pin not in the active day-highlight set', () => {
    expect(isPinDimmed(jpPin, null, new Set(['other']))).toBe(true);
    expect(isPinDimmed(jpPin, null, new Set(['s1']))).toBe(false);
  });

  it('requires passing BOTH filters to stay un-dimmed', () => {
    // In-country but not in the highlighted day → dimmed.
    expect(isPinDimmed(jpPin, 'JP', new Set(['other']))).toBe(true);
    // In the highlighted day but wrong country → dimmed.
    expect(isPinDimmed(jpPin, 'FR', new Set(['s1']))).toBe(true);
    // Passes both → not dimmed.
    expect(isPinDimmed(jpPin, 'JP', new Set(['s1']))).toBe(false);
  });
});

describe('isArcDimmed (country × day-highlight composition)', () => {
  const gbJpArc = arc({ segmentId: 'f1', originCountry: 'GB', destCountry: 'JP' });

  it('is not dimmed with neither filter active', () => {
    expect(isArcDimmed(gbJpArc, null, null)).toBe(false);
  });

  it('dims unless BOTH endpoints sit in the active country', () => {
    expect(isArcDimmed(gbJpArc, 'JP', null)).toBe(true); // origin GB is out
    expect(isArcDimmed(gbJpArc, 'GB', null)).toBe(true); // dest JP is out
    expect(
      isArcDimmed(arc({ segmentId: 'f2', originCountry: 'JP', destCountry: 'JP' }), 'JP', null),
    ).toBe(false);
  });

  it('dims an arc not in the active day-highlight set', () => {
    expect(isArcDimmed(gbJpArc, null, new Set(['other']))).toBe(true);
    expect(isArcDimmed(gbJpArc, null, new Set(['f1']))).toBe(false);
  });
});
