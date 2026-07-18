import { describe, expect, it } from 'vitest';

import { flightDurationMinutes, formatFlightDuration } from './flight-duration';

// Floating wall clock per ADR-0016: the Date's UTC fields ARE the
// printed time. All flights here are synthetic.
function wall(iso: string): Date {
  return new Date(`${iso}Z`);
}

describe('flightDurationMinutes', () => {
  it('anchors each end to its airport zone (westbound long-haul)', () => {
    // HAN (+07) 10:30 → CDG (+02 in July) 17:30 same day: 12h real.
    const minutes = flightDurationMinutes({
      startsAt: wall('2026-07-20T10:30:00'),
      endsAt: wall('2026-07-20T17:30:00'),
      originAirport: 'HAN',
      destinationAirport: 'CDG',
    });
    expect(minutes).toBe(12 * 60);
  });

  it('handles eastbound overnight arrivals past midnight', () => {
    // LHR (+01 in October) 11:05 → HND (+09) 08:55 next day: 13h 50m.
    const minutes = flightDurationMinutes({
      startsAt: wall('2025-10-04T11:05:00'),
      endsAt: wall('2025-10-05T08:55:00'),
      originAirport: 'LHR',
      destinationAirport: 'HND',
    });
    expect(minutes).toBe(13 * 60 + 50);
  });

  it('computes same-zone short hops from the plain difference', () => {
    const minutes = flightDurationMinutes({
      startsAt: wall('2026-03-01T09:00:00'),
      endsAt: wall('2026-03-01T10:15:00'),
      originAirport: 'HAN',
      destinationAirport: 'SGN',
    });
    expect(minutes).toBe(75);
  });

  it('returns null for missing times, unknown airports, or nonsense', () => {
    const base = {
      startsAt: wall('2026-07-20T10:30:00'),
      endsAt: wall('2026-07-20T17:30:00'),
    };
    expect(flightDurationMinutes({ ...base, endsAt: null, originAirport: 'HAN' })).toBeNull();
    expect(
      flightDurationMinutes({ ...base, originAirport: 'XXX', destinationAirport: 'CDG' }),
    ).toBeNull();
    // Arrival "before" departure once anchored — bad data, not -9h.
    expect(
      flightDurationMinutes({
        startsAt: wall('2026-07-20T10:30:00'),
        endsAt: wall('2026-07-20T05:30:00'),
        originAirport: 'CDG',
        destinationAirport: 'HAN',
      }),
    ).toBeNull();
  });
});

describe('formatFlightDuration', () => {
  it('formats hours and minutes tersely', () => {
    expect(formatFlightDuration(765)).toBe('12h 45m');
    expect(formatFlightDuration(120)).toBe('2h');
    expect(formatFlightDuration(45)).toBe('45m');
  });
});
