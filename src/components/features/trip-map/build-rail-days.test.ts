import { describe, expect, it } from 'vitest';

import type { ClassifiedDay } from '@/components/features/segments/day-temporal';
import type { Segment } from '@/lib/segments';
import type { TripMapArc, TripMapPin } from '@/lib/trip-map/repo';

import { buildRailDays } from './build-rail-days';
import { indexMapGeometry } from './timeline-model';

function seg(overrides: Partial<Segment> & { id: string; type: Segment['type'] }): Segment {
  return {
    tripId: 'trip-1',
    data: {},
    startsAt: new Date(Date.UTC(2025, 9, 5, 9, 12)),
    endsAt: null,
    locationName: null,
    countryCode: 'JP',
    originCountryCode: null,
    needsReview: false,
    wishlistItemId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    searchText: null,
    searchTsv: null,
    ...overrides,
  } as unknown as Segment;
}

function classifiedDay(segments: Segment[]): ClassifiedDay {
  return {
    date: new Date(2025, 9, 5),
    dayNumber: 1,
    position: 'today',
    segments,
  };
}

const flightPin: TripMapPin = {
  segmentId: 'flight-1',
  kind: 'flight',
  label: 'HND',
  country: 'JP',
  lat: 35.55,
  lng: 139.78,
  date: null,
};
const flightArc: TripMapArc = {
  segmentId: 'flight-1',
  originLat: 51.47,
  originLng: -0.45,
  destLat: 35.55,
  destLng: 139.78,
  originCountry: 'GB',
  destCountry: 'JP',
};
const hotelPin: TripMapPin = {
  segmentId: 'hotel-1',
  kind: 'hotel',
  label: 'Hotel Niwa Tokyo',
  country: 'JP',
  lat: 35.69,
  lng: 139.75,
  date: null,
};

describe('buildRailDays', () => {
  it('maps a flight to its arc, headlining the origin→dest IATA pair', () => {
    const flight = seg({
      id: 'flight-1',
      type: 'flight',
      data: { originAirport: 'LHR', destinationAirport: 'HND', carrier: 'JL', flightNumber: '42' },
    });
    const geometry = indexMapGeometry([flightPin], [flightArc]);
    const [day] = buildRailDays([classifiedDay([flight])], geometry);
    const it0 = day!.items[0]!;
    expect(it0.mapKind).toBe('arc');
    expect(it0.label).toBe('LHR → HND');
    expect(it0.icon).toBe('flight');
    // Country tracks the arc's destination (ADR-0005).
    expect(it0.country).toBe('JP');
    expect(it0.timeLabel).toBe('09:12');
  });

  it('maps a geocoded hotel to its pin and headlines the property name', () => {
    const hotel = seg({
      id: 'hotel-1',
      type: 'hotel',
      data: { propertyName: 'Hotel Niwa Tokyo' },
      // Date-only check-in → no time label.
      startsAt: new Date(Date.UTC(2025, 9, 5)),
    });
    const geometry = indexMapGeometry([hotelPin], []);
    const [day] = buildRailDays([classifiedDay([hotel])], geometry);
    const it0 = day!.items[0]!;
    expect(it0.mapKind).toBe('pin');
    expect(it0.label).toBe('Hotel Niwa Tokyo');
    expect(it0.timeLabel).toBeNull();
  });

  it('marks a note off-map with a reason', () => {
    const note = seg({ id: 'note-1', type: 'note', data: { body: 'Buy matcha at Ippodo.' } });
    const [day] = buildRailDays([classifiedDay([note])], indexMapGeometry([], []));
    const it0 = day!.items[0]!;
    expect(it0.mapKind).toBe('none');
    expect(it0.icon).toBe('note');
    expect(it0.offMapReason).toBeTruthy();
    expect(it0.label).toBe('Buy matcha at Ippodo.');
  });

  it('marks an ungeocoded segment off-map (no pin in the index)', () => {
    const activity = seg({
      id: 'act-1',
      type: 'activity',
      data: { title: "Friend's place — drinks" },
    });
    const [day] = buildRailDays([classifiedDay([activity])], indexMapGeometry([], []));
    const it0 = day!.items[0]!;
    expect(it0.mapKind).toBe('none');
    expect(it0.label).toBe("Friend's place — drinks");
    expect(it0.offMapReason).toBeTruthy();
  });

  it('truncates a long note body to a preview', () => {
    const body = 'x'.repeat(200);
    const note = seg({ id: 'note-2', type: 'note', data: { body } });
    const [day] = buildRailDays([classifiedDay([note])], indexMapGeometry([], []));
    expect(day!.items[0]!.label.endsWith('…')).toBe(true);
    expect(day!.items[0]!.label.length).toBeLessThanOrEqual(80);
  });

  it('preserves day order and segment order', () => {
    const a = seg({ id: 'a', type: 'activity', data: { title: 'A' } });
    const b = seg({ id: 'b', type: 'activity', data: { title: 'B' } });
    const [day] = buildRailDays([classifiedDay([a, b])], indexMapGeometry([], []));
    expect(day!.items.map((i) => i.segmentId)).toEqual(['a', 'b']);
  });
});
