// Soft date check for auto-created segments (ADR-0008).
//
// The trip's stated dates are the user's plan. A boarding pass for a
// red-eye that lands the day after `endDate` is *truthful*, even if
// the user's plan was sloppy. Hard rejection would force the user to
// edit the trip just to file a real document. Quiet snapping would
// silently rewrite the document's truth. The compromise is a soft
// advisory window: the segment lands as-is and the UI flags it for
// review when it falls outside.
//
// Wishlist trips (one or both dates null) skip the check entirely —
// there's no window to compare against.

import type { Trip } from '@/lib/trips/repo';

/**
 * ±2 day tolerance around the trip's start and end. Captures the
 * common red-eye cases (overnight flight departing the day before the
 * stated trip start; return flight landing the day after the stated
 * end) without being so loose that obviously-wrong dates pass.
 */
export const TRIP_DATE_TOLERANCE_DAYS = 2;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True when `eventDate` is inside `[startDate - tolerance, endDate + tolerance]`.
 *
 *   - Null `eventDate`     → true (no date to compare; never flag).
 *   - Null `trip.startDate` OR null `trip.endDate` → true (wishlist trip).
 *
 * Boundary-inclusive on both sides: a flight exactly `tolerance` days
 * before `startDate` is in window.
 */
export function isWithinTripWindow(eventDate: Date | null, trip: Trip): boolean {
  if (eventDate === null) return true;
  if (trip.startDate === null || trip.endDate === null) return true;

  const toleranceMs = TRIP_DATE_TOLERANCE_DAYS * MS_PER_DAY;
  const t = eventDate.getTime();
  const lo = trip.startDate.getTime() - toleranceMs;
  const hi = trip.endDate.getTime() + toleranceMs;
  return t >= lo && t <= hi;
}
