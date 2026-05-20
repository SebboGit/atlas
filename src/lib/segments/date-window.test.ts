import { describe, expect, it } from 'vitest';

import type { Trip } from '@/lib/trips/repo';

import { isWithinTripWindow, TRIP_DATE_TOLERANCE_DAYS } from './date-window';

// Pin the tolerance the tests run against. If TRIP_DATE_TOLERANCE_DAYS
// changes, this test surfaces it so the soft-window expectations get
// re-visited rather than silently shifting.
const TOLERANCE = TRIP_DATE_TOLERANCE_DAYS;

function makeTrip(start: Date | null, end: Date | null): Trip {
  return {
    id: 'trip-1',
    userId: 'user-1',
    title: 'Test',
    summary: null,
    status: 'planned',
    coverImageId: null,
    startDate: start,
    endDate: end,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as unknown as Trip;
}

describe('isWithinTripWindow', () => {
  // Use local-midnight Dates throughout — same shape the mapper
  // produces and the form layer uses.
  const start = new Date(2026, 5, 1); // 1 Jun
  const end = new Date(2026, 5, 10); // 10 Jun
  const trip = makeTrip(start, end);

  it('returns true for dates strictly inside the window', () => {
    expect(isWithinTripWindow(new Date(2026, 5, 5), trip)).toBe(true);
  });

  it('returns true at the start and end boundaries', () => {
    expect(isWithinTripWindow(start, trip)).toBe(true);
    expect(isWithinTripWindow(end, trip)).toBe(true);
  });

  it('returns true within ±tolerance of the start (overnight outbound flight)', () => {
    const dayBeforeStart = new Date(2026, 4, 31); // 31 May (1 day before)
    expect(isWithinTripWindow(dayBeforeStart, trip)).toBe(true);

    const toleranceBeforeStart = new Date(2026, 4, 31 - (TOLERANCE - 1)); // tolerance days before
    expect(isWithinTripWindow(toleranceBeforeStart, trip)).toBe(true);
  });

  it('returns true within ±tolerance of the end (returning red-eye)', () => {
    const dayAfterEnd = new Date(2026, 5, 11);
    expect(isWithinTripWindow(dayAfterEnd, trip)).toBe(true);

    const toleranceAfterEnd = new Date(2026, 5, 10 + TOLERANCE);
    expect(isWithinTripWindow(toleranceAfterEnd, trip)).toBe(true);
  });

  it('returns false just past the tolerance window', () => {
    const justBeforeWindow = new Date(2026, 5, 1 - TOLERANCE - 1);
    expect(isWithinTripWindow(justBeforeWindow, trip)).toBe(false);

    const justAfterWindow = new Date(2026, 5, 10 + TOLERANCE + 1);
    expect(isWithinTripWindow(justAfterWindow, trip)).toBe(false);
  });

  it('returns false for a date wildly outside the window (August on a June trip)', () => {
    const august = new Date(2026, 7, 15);
    expect(isWithinTripWindow(august, trip)).toBe(false);
  });

  it('returns true when eventDate is null (no date to check)', () => {
    expect(isWithinTripWindow(null, trip)).toBe(true);
  });

  it('returns true for wishlist trips with null startDate', () => {
    expect(isWithinTripWindow(new Date(2026, 5, 5), makeTrip(null, end))).toBe(true);
  });

  it('returns true for wishlist trips with null endDate', () => {
    expect(isWithinTripWindow(new Date(2026, 5, 5), makeTrip(start, null))).toBe(true);
  });

  it('returns true for fully-wishlist trips (both dates null)', () => {
    expect(isWithinTripWindow(new Date(2026, 5, 5), makeTrip(null, null))).toBe(true);
  });
});
