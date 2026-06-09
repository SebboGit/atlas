import type { Segment } from '@/lib/segments';
import {
  activityDataSchema,
  flightDataSchema,
  hotelDataSchema,
  transitDataSchema,
} from '@/lib/segments';

import { continuesThroughDay } from './day-temporal';
import { dayKey } from './group-by-day';
import type { ItineraryDay } from './itinerary-day-list';

// The "you're still here" continuations for each day: every span-capable
// segment (both endpoints set) that `continuesThroughDay` the day from an
// earlier check-in. A multi-day stay therefore surfaces a quiet row on
// EVERY day it spans after its check-in — its check-out day included —
// whether the check-in card is past, today, or future, collapsed or
// visible. The itinerary renders the full trip calendar (fillDayRange),
// so this is what keeps an otherwise-empty mid-stay day from reading as
// a blank: the stay IS the day's content.
//
// No clock, no `position`, and no viewer timezone input — the gating is
// pure UTC-day-token math (`continuesThroughDay`), so the result is
// byte-identical on the server render, the pre-mount paint, and every
// client. A segment never appears as a continuation on its own check-in
// day (`continuesThroughDay` requires a strictly earlier start).
export function continuationsByDayKey(
  days: Array<Pick<ItineraryDay, 'key' | 'dateKey' | 'segments'>>,
): Map<string, Segment[]> {
  const spanning: Array<{ seg: Segment; bucketKey: string }> = [];
  for (const day of days) {
    for (const seg of day.segments) {
      if (!seg.startsAt || !seg.endsAt) continue;
      spanning.push({ seg, bucketKey: day.key });
    }
  }
  if (spanning.length === 0) return new Map();

  const byDay = new Map<string, Segment[]>();
  for (const day of days) {
    const conts: Segment[] = [];
    for (const { seg, bucketKey } of spanning) {
      if (bucketKey === day.key) continue;
      if (continuesThroughDay(seg, day.dateKey)) conts.push(seg);
    }
    if (conts.length > 0) byDay.set(day.key, conts);
  }
  return byDay;
}

// The display name shown on a continuation row — the segment's headline,
// derived the same way each SegmentCard variant derives its title so the
// continuation reads as the same place. Falls back to a type label when
// the structured `data` doesn't parse or carries no name. Food and notes
// never reach here (food is point-in-time, notes carry no endsAt — see
// `continuesThroughDay`'s guard), so this only has to cover the
// span-capable types well; the `default` keeps it total.
export function continuationName(segment: Segment): string {
  switch (segment.type) {
    case 'hotel': {
      const parsed = hotelDataSchema.safeParse(segment.data);
      return parsed.success ? parsed.data.propertyName : 'Hotel';
    }
    case 'activity': {
      const parsed = activityDataSchema.safeParse(segment.data);
      return parsed.success ? parsed.data.title : 'Activity';
    }
    case 'transit': {
      const parsed = transitDataSchema.safeParse(segment.data);
      if (parsed.success) {
        const { fromName, toName } = parsed.data;
        if (fromName && toName) return `${fromName} → ${toName}`;
        if (fromName) return fromName;
        if (toName) return toName;
      }
      return 'Transit';
    }
    case 'flight': {
      const parsed = flightDataSchema.safeParse(segment.data);
      if (parsed.success) {
        const { carrier, flightNumber } = parsed.data;
        const label = [carrier, flightNumber].filter(Boolean).join(' ');
        if (label) return label;
      }
      return 'Flight';
    }
    default:
      // Food / note never span days; locationName is the best remaining
      // signal for any future span-capable type added without a case.
      return segment.locationName ?? 'Segment';
  }
}

// The check-out time to surface on a continuation row — but ONLY on the
// stay's final day, and only for a hotel that carries a check-out time.
// Returns null on every earlier continuation day, for non-hotels, and when
// no time was entered.
//
// `dayKeyToken` is the `YYYY-MM-DD` key of the day the row renders under.
// The match is on the UTC day of `endsAt` — the same token basis the row
// gating (`continuesThroughDay`) uses, so the chip lands on the last day
// the stay actually renders, identically on the server and in every
// viewer timezone. The UTC check-out day is always a rendered day:
// `fillDayRange` extends the calendar through the latest `endsAt`. (When
// the fill's pathological-range cap trips, the day may be missing and
// the chip simply isn't shown — the info dialog still carries the time.)
//
// Mirrors how the check-in time shows on the check-in card: the time is
// display-only `data` metadata, never the date-only `endsAt` that anchors
// the day, so it has no bearing on ordering.
export function continuationCheckOutTime(segment: Segment, dayKeyToken: string): string | null {
  if (segment.type !== 'hotel' || !segment.endsAt) return null;
  if (dayKey(segment.endsAt) !== dayKeyToken) return null;
  const parsed = hotelDataSchema.safeParse(segment.data);
  return parsed.success ? (parsed.data.checkOutTime ?? null) : null;
}
