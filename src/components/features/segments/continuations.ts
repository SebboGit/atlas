import type { Segment } from '@/lib/segments';
import {
  activityDataSchema,
  flightDataSchema,
  hotelDataSchema,
  transitDataSchema,
} from '@/lib/segments';

import { continuesThroughDay, startOfLocalDay } from './day-temporal';
import type { ItineraryDay } from './itinerary-day-list';

// Parses an `ItineraryDay.dateKey` (`YYYY-MM-DD`) into a local-midnight
// Date for the calendar-day maths `continuesThroughDay` needs. Kept
// local (rather than importing the client component's `parseDayKey`) so
// this module stays pure and unit-testable without pulling in the date
// picker. The token is server-generated and structurally valid; a bad
// parse falls back to the epoch rather than crashing.
function parseDateKey(dateKey: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return new Date(0);
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

// The "you're still here" continuations to surface on each visible
// (today/future) day once the past — which holds their check-in bucket —
// collapses. A segment is a continuation on a visible day iff its
// check-in bucket day is itself `past` (so its primary card collapsed)
// and the segment `continuesThroughDay` that visible day from that
// earlier check-in.
//
// CONSISTENCY: this is driven entirely by the server-set `position`
// field — the SAME signal `splitCollapsedDays` reads to decide which
// days collapse — so it cannot disagree with the split. There is no
// `today`/clock input here: gating a continuation on "its check-in day's
// position is past" is exactly "its check-in day collapsed", by
// construction. A segment never appears as a continuation on its own
// check-in day, and continuations are never emitted for `past` days
// (they're collapsed).
//
// Mirrors the shared `ongoingContinuationsByDayKey` in `day-temporal.ts`
// (which the rail uses over `ClassifiedDay`), adapted to the serialised
// `ItineraryDay` shape the page hands the client (`dateKey` token,
// `position` already resolved — not a re-derived `Date`/`today`).
export function continuationsByDayKey(days: ItineraryDay[]): Map<string, Segment[]> {
  // Segments whose check-in bucket has collapsed (its day is `past`),
  // paired with that bucket's key so a continuation never doubles up on
  // its own check-in day. Only past-bucket segments can continue into a
  // visible day from a *collapsed* check-in — a stay checking in today is
  // a normal same-day card, not a continuation.
  const fromCollapsed: Array<{ seg: Segment; bucketKey: string }> = [];
  for (const day of days) {
    if (day.position !== 'past') continue;
    for (const seg of day.segments) {
      fromCollapsed.push({ seg, bucketKey: day.key });
    }
  }
  if (fromCollapsed.length === 0) return new Map();

  const byDay = new Map<string, Segment[]>();
  for (const day of days) {
    if (day.position === 'past') continue;
    const dayDate = parseDateKey(day.dateKey);
    const conts: Segment[] = [];
    for (const { seg, bucketKey } of fromCollapsed) {
      if (bucketKey === day.key) continue;
      if (continuesThroughDay(seg, dayDate)) conts.push(seg);
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
// `isOngoing`), so this only has to cover the span-capable types well;
// the `default` keeps it total.
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
// no time was entered. (When the check-out day isn't itself a rendered
// bucket, no continuation row exists there and the time simply isn't shown
// — the info dialog still carries it.)
//
// `dayKeyToken` is the `YYYY-MM-DD` key of the day the row renders under.
// The match is on LOCAL-day math (via `startOfLocalDay`), NOT UTC `dayKey`,
// because the row's existence is decided by `continuesThroughDay` (also
// local-day). A date-only hotel's `endsAt` is `00:00Z`, whose local day
// sits a day earlier west of UTC — matching on UTC would land the time on
// a day no row exists for, so it would vanish entirely. CI runs in UTC and
// never sees that skew (see the off-UTC regression test); this keeps the
// time on whatever day the last continuation row actually renders.
//
// Mirrors how the check-in time shows on the check-in card: the time is
// display-only `data` metadata, never the date-only `endsAt` that anchors
// the day, so it has no bearing on ordering.
export function continuationCheckOutTime(segment: Segment, dayKeyToken: string): string | null {
  if (segment.type !== 'hotel' || !segment.endsAt) return null;
  if (startOfLocalDay(segment.endsAt) !== startOfLocalDay(parseDateKey(dayKeyToken))) return null;
  const parsed = hotelDataSchema.safeParse(segment.data);
  return parsed.success ? (parsed.data.checkOutTime ?? null) : null;
}
