import { describe, expect, it } from 'vitest';

import type { TripMapArc, TripMapPin } from '@/lib/trip-map/repo';

import {
  indexMapGeometry,
  isArcDimmed,
  isPinDimmed,
  mappableSegmentIds,
  resolveRailDays,
  type RailContinuationCandidate,
  type RailDay,
  type RailItem,
  type ResolvedRailDay,
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

// A client-resolved day (carries `position`, no continuationCandidates) —
// the shape the rail / sheet / highlight maths consume.
function day(overrides: Partial<ResolvedRailDay> & { items: RailItem[] }): ResolvedRailDay {
  return {
    key: '2025-10-05',
    dateKey: '2025-10-05',
    dayNumber: 1,
    position: 'today',
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

// The viewer-relative classification + continuation fold that mirrors the
// itinerary tab (ADR-0016), so the map rail and the itinerary never
// disagree on "today" near midnight in a non-UTC zone. Candidate
// endpoints are UTC instants (the gating is UTC-token math); the `today`
// fixtures stay local because classifyDay is genuinely viewer-local.
describe('resolveRailDays', () => {
  function serverDay(
    dateKey: string,
    dayNumber: number,
    items: RailItem[],
    continuationCandidates: RailContinuationCandidate[] = [],
  ): RailDay {
    return { key: dateKey, dateKey, dayNumber, items, continuationCandidates };
  }
  function candidate(
    segmentId: string,
    startsAt: Date,
    endsAt: Date,
    checkOutTime: string | null = null,
  ): RailContinuationCandidate {
    return {
      item: item({ segmentId, continuation: true, continuationSince: '04 Oct' }),
      startsAt,
      endsAt,
      checkOutTime,
    };
  }

  // 3-day trip: 04 Oct, 05 Oct, 06 Oct, with a hotel checking in 04 Oct and
  // out 06 Oct — a stay spanning the two later days.
  const hotelCandidate = candidate(
    'hotel-1',
    new Date(Date.UTC(2025, 9, 4)),
    new Date(Date.UTC(2025, 9, 6)),
  );
  const serverDays: RailDay[] = [
    serverDay('2025-10-04', 1, [item({ segmentId: 'hotel-1' })], [hotelCandidate]),
    serverDay('2025-10-05', 2, [item({ segmentId: 'act-1' })]),
    serverDay('2025-10-06', 3, [item({ segmentId: 'act-2' })]),
  ];

  it('pre-mount (null today) neutralises position but still folds continuations', () => {
    // Continuations are clock-free — they derive from spans alone, so the
    // pre-mount paint already carries them; only `position` waits for the
    // viewer's clock.
    const out = resolveRailDays(serverDays, null);
    expect(out.map((d) => d.position)).toEqual(['future', 'future', 'future']);
    expect(out[1]!.items.map((i) => i.segmentId)).toEqual(['hotel-1', 'act-1']);
    expect(out[2]!.items.map((i) => i.segmentId)).toEqual(['hotel-1', 'act-2']);
  });

  it('classifies against the viewer today and folds continuations onto spanned days', () => {
    const today = new Date(2025, 9, 5, 12, 0, 0);
    const out = resolveRailDays(serverDays, today);
    expect(out.map((d) => d.position)).toEqual(['past', 'today', 'future']);
    // The check-in day shows its own row only.
    expect(out[0]!.items.map((i) => i.segmentId)).toEqual(['hotel-1']);
    // Today + future each LEAD with the "Staying since" continuation row.
    expect(out[1]!.items.map((i) => i.segmentId)).toEqual(['hotel-1', 'act-1']);
    expect(out[1]!.items[0]!.continuation).toBe(true);
    expect(out[2]!.items.map((i) => i.segmentId)).toEqual(['hotel-1', 'act-2']);
  });

  it("stamps the hotel check-out time on the stay's final day only", () => {
    const withCheckout: RailDay[] = [
      serverDay(
        '2025-10-04',
        1,
        [item({ segmentId: 'hotel-1' })],
        [
          candidate(
            'hotel-1',
            new Date(Date.UTC(2025, 9, 4)),
            new Date(Date.UTC(2025, 9, 6)),
            '11:00',
          ),
        ],
      ),
      serverDay('2025-10-05', 2, [item({ segmentId: 'act-1' })]),
      serverDay('2025-10-06', 3, [item({ segmentId: 'act-2' })]),
    ];
    const out = resolveRailDays(withCheckout, new Date(2025, 9, 5, 12, 0, 0));
    // 05 Oct: the stay continues but it isn't the check-out day → no chip.
    expect(out[1]!.items.find((i) => i.segmentId === 'hotel-1')!.continuationCheckOut ?? null).toBe(
      null,
    );
    // 06 Oct: the check-out day → the time is stamped.
    expect(out[2]!.items.find((i) => i.segmentId === 'hotel-1')!.continuationCheckOut).toBe(
      '11:00',
    );
  });

  it('surfaces continuations even when the check-in day has not collapsed', () => {
    // today = 04 Oct: the hotel's check-in day is itself today (not past).
    // The later days it spans still lead with the "staying" row — the rail
    // renders the trip's full calendar, so a mid-stay day must read as
    // "staying" whether or not the check-in card folded.
    const today = new Date(2025, 9, 4, 12, 0, 0);
    const out = resolveRailDays(serverDays, today);
    expect(out.map((d) => d.position)).toEqual(['today', 'future', 'future']);
    // Never on its own check-in day…
    expect(out[0]!.items.map((i) => i.segmentId)).toEqual(['hotel-1']);
    expect(out[0]!.items[0]!.continuation).toBeUndefined();
    // …but on every later spanned day.
    expect(out[1]!.items.map((i) => i.segmentId)).toEqual(['hotel-1', 'act-1']);
    expect(out[2]!.items.map((i) => i.segmentId)).toEqual(['hotel-1', 'act-2']);
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
