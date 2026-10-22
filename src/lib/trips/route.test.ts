import { describe, expect, it } from 'vitest';

import { buildTripRoute } from './route';

const at = (iso: string) => new Date(iso);

const flight = (
  from: string,
  to: string,
  iso: string,
  flightNumber = '42',
  endIso: string | null = null,
) => ({
  type: 'flight' as const,
  data: { carrier: 'JL', flightNumber, originAirport: from, destinationAirport: to },
  startsAt: at(iso),
  endsAt: endIso ? at(endIso) : null,
});

const train = (from: string, to: string, iso: string) => ({
  type: 'transit' as const,
  data: { mode: 'train', fromName: from, toName: to },
  startsAt: at(iso),
  endsAt: null,
});

describe('buildTripRoute', () => {
  it('chains flights and transit, with a transfer where legs do not meet', () => {
    const route = buildTripRoute([
      flight('LHR', 'HND', '2025-10-04T11:05:00Z'),
      train('Tokyo Station', 'Kyoto Station', '2025-10-07T09:12:00Z'),
      flight('KIX', 'LHR', '2025-10-10T11:40:00Z', '43'),
    ]);

    expect(route.map((s) => [s.label, s.via, s.arrivedOn])).toEqual([
      ['LHR', null, null],
      ['HND', 'flight', '2025-10-04'],
      ['Tokyo', 'transfer', '2025-10-07'],
      ['Kyoto', 'transit', '2025-10-07'],
      ['KIX', 'transfer', '2025-10-10'],
      ['LHR', 'flight', '2025-10-10'],
    ]);
    expect(route[1]?.viaLabel).toBe('JL 42');
    expect(route[3]?.viaLabel).toBe('train');
  });

  it('joins legs that meet without a transfer', () => {
    const route = buildTripRoute([
      flight('LHR', 'DOH', '2025-01-01T08:00:00Z'),
      flight('DOH', 'BKK', '2025-01-01T20:00:00Z'),
    ]);
    expect(route.map((s) => s.label)).toEqual(['LHR', 'DOH', 'BKK']);
    expect(route.every((s) => s.via !== 'transfer')).toBe(true);
  });

  it('orders legs by start time, not by input order', () => {
    const route = buildTripRoute([
      flight('DOH', 'BKK', '2025-01-01T20:00:00Z'),
      flight('LHR', 'DOH', '2025-01-01T08:00:00Z'),
    ]);
    expect(route.map((s) => s.label)).toEqual(['LHR', 'DOH', 'BKK']);
  });

  it('leaves local bus and car hops off the route', () => {
    const route = buildTripRoute([
      train('Tokyo Station', 'Kyoto Station', '2025-10-07T09:12:00Z'),
      {
        type: 'transit' as const,
        data: { mode: 'bus', fromName: 'Kyoto Station', toName: 'Ryokan pickup' },
        startsAt: at('2025-10-08T14:00:00Z'),
        endsAt: null,
      },
    ]);
    expect(route.map((s) => s.label)).toEqual(['Tokyo', 'Kyoto']);
  });

  it("dates an overnight flight's destination by its arrival", () => {
    const route = buildTripRoute([
      flight('FRA', 'HND', '2025-10-01T20:00:00Z', '204', '2025-10-02T15:00:00Z'),
    ]);
    expect(route.map((s) => s.arrivedOn)).toEqual([null, '2025-10-02']);
  });

  it('draws a leg booked twice only once', () => {
    const route = buildTripRoute([
      flight('FRA', 'HND', '2025-10-01T20:00:00Z', '204'),
      flight('FRA', 'HND', '2025-10-01T20:00:00Z', '204'),
    ]);
    expect(route.map((s) => s.label)).toEqual(['FRA', 'HND']);
  });

  it('skips undated legs, other segment types and legs missing an end', () => {
    const route = buildTripRoute([
      {
        type: 'hotel',
        data: { propertyName: 'Hotel Niwa' },
        startsAt: at('2025-10-05T00:00:00Z'),
        endsAt: null,
      },
      { ...flight('LHR', 'HND', '2025-10-04T11:05:00Z'), startsAt: null },
      {
        type: 'transit',
        data: { mode: 'train', fromName: 'Kyoto' },
        startsAt: at('2025-10-08T14:00:00Z'),
        endsAt: null,
      },
    ]);
    expect(route).toEqual([]);
  });
});
