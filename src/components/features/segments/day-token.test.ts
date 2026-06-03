import { describe, expect, it } from 'vitest';

import { parseDateString } from '@/components/ui/date-picker';

import { dayKey } from './group-by-day';

// The itinerary serialises each day's date as a `YYYY-MM-DD` token
// (`ItineraryDay.dateKey`) rather than a UTC ISO instant: the server
// produces it with `dayKey`, the client reparses it with
// `parseDateString`. `dayKey` reads the instant's UTC calendar day —
// segment times are floating-UTC wall-clocks (ADR-0014), so the day a
// segment "reads" is its UTC day, identical on any server timezone. The
// client reparses the token to a local-midnight date for display, so the
// rendered calendar day never shifts. These tests pin that contract;
// inputs are explicit UTC instants to stay deterministic on any runner.
describe('day token round-trip (dayKey ↔ parseDateString)', () => {
  it('round-trips a UTC instant back to its UTC calendar day', () => {
    const original = new Date(Date.UTC(2026, 4, 21)); // 21 May 2026 UTC
    const reparsed = parseDateString(dayKey(original));
    expect(reparsed).toBeDefined();
    expect(reparsed!.getFullYear()).toBe(2026);
    expect(reparsed!.getMonth()).toBe(4);
    expect(reparsed!.getDate()).toBe(21);
  });

  it('keys a late-evening wall-clock to its own UTC day, not the next', () => {
    // 23:30 UTC must token-ise to the same calendar day — not slip a day.
    const evening = new Date(Date.UTC(2026, 4, 21, 23, 30));
    expect(dayKey(evening)).toBe('2026-05-21');
  });

  it('keys a midday UTC instant to its UTC day on any runner timezone', () => {
    expect(dayKey(new Date('2026-05-21T12:00:00Z'))).toBe('2026-05-21');
  });

  it('reparses the token as a local-midnight date', () => {
    // `parseDateString` builds the date in local time, so the rendered
    // calendar day never shifts by the client's timezone offset.
    const reparsed = parseDateString(dayKey(new Date(Date.UTC(2026, 0, 1))));
    expect(reparsed).toBeDefined();
    expect(reparsed!.getHours()).toBe(0);
    expect(reparsed!.getMinutes()).toBe(0);
    expect(reparsed!.getSeconds()).toBe(0);
  });

  it('emits a zero-padded YYYY-MM-DD token', () => {
    expect(dayKey(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
    expect(dayKey(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-12-31');
  });
});
