import { describe, expect, it } from 'vitest';

import { parseDateString } from '@/components/ui/date-picker';

import { dayKey } from './group-by-day';

// The itinerary serialises each day's date as a `YYYY-MM-DD` token
// (`ItineraryDay.dateKey`) rather than a UTC ISO instant: the server
// produces it with `dayKey`, the client reparses it with
// `parseDateString`. A UTC ISO instant reparsed on a client in a
// different timezone than the server can land on the wrong calendar
// day; the token round-trip must not. These tests pin that contract.
describe('day token round-trip (dayKey ↔ parseDateString)', () => {
  it('round-trips a date back to the same calendar day', () => {
    const original = new Date(2026, 4, 21); // 21 May 2026, local midnight
    const reparsed = parseDateString(dayKey(original));
    expect(reparsed).toBeDefined();
    expect(reparsed!.getFullYear()).toBe(2026);
    expect(reparsed!.getMonth()).toBe(4);
    expect(reparsed!.getDate()).toBe(21);
  });

  it('preserves the calendar day even from a late-evening wall-clock time', () => {
    // A bucket date carrying an evening time must still token-ise and
    // reparse to the *same* calendar day — not slip to the next day.
    const evening = new Date(2026, 4, 21, 23, 30);
    const reparsed = parseDateString(dayKey(evening));
    expect(reparsed).toBeDefined();
    expect(reparsed!.getDate()).toBe(21);
    expect(reparsed!.getMonth()).toBe(4);
  });

  it('reparses the token as a local-midnight date', () => {
    // `parseDateString` builds the date in local time, so the rendered
    // calendar day never shifts by the client's timezone offset.
    const reparsed = parseDateString(dayKey(new Date(2026, 0, 1)));
    expect(reparsed).toBeDefined();
    expect(reparsed!.getHours()).toBe(0);
    expect(reparsed!.getMinutes()).toBe(0);
    expect(reparsed!.getSeconds()).toBe(0);
  });

  it('emits a zero-padded YYYY-MM-DD token', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
