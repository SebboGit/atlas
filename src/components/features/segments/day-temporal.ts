import type { Segment } from '@/lib/segments';

import type { DayBucket } from './group-by-day';

// Where a calendar day sits relative to "now". Past days are reference
// material, today is the focus, future days are a preview — the
// collapsed-itinerary pattern (issue #8) and the chronological-map
// rail (issue #9) both lean on this single classification so the two
// surfaces stay in agreement about what "past" means.
export type DayPosition = 'past' | 'today' | 'future';

// Midnight (local) of the given date. `groupSegmentsByDay` already
// normalises bucket dates to local midnight, but callers passing a raw
// `new Date()` need this to compare on calendar-day boundaries.
function startOfLocalDay(d: Date): number {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

// Classifies a single calendar day. A day-bucket spans exactly one
// calendar day (see `groupSegmentsByDay`), so a plain day-vs-day
// comparison is all that's needed — no range maths.
//
// `today` is injected rather than read from `new Date()` so the
// function stays pure and unit-testable, and so the server component
// can compute the same value the client hydrates against.
export function classifyDay(dayDate: Date, today: Date): DayPosition {
  const day = startOfLocalDay(dayDate);
  const ref = startOfLocalDay(today);
  if (day < ref) return 'past';
  if (day > ref) return 'future';
  return 'today';
}

// A day-bucket with its temporal position resolved. Adds a 1-based
// `dayNumber` (chronological index) and a `position` so render code
// doesn't re-derive either.
export interface ClassifiedDay extends DayBucket {
  dayNumber: number;
  position: DayPosition;
}

// True when a segment is *ongoing as of today* — it began on an earlier
// calendar day but has not yet finished. The motivating case is a
// multi-day hotel: a stay running 19–23 May is keyed into the "19 May"
// day bucket by `groupSegmentsByDay`, so a naive collapse of every past
// day would swallow a stay that is relevant *right now*.
//
// Both endpoints are compared on local calendar-day boundaries (same
// `startOfLocalDay` normalisation `classifyDay` uses), so a check-out
// timestamp at any time on `today` still counts as ongoing. A segment
// missing either endpoint cannot span a range and is never ongoing —
// a single-day or open-ended segment is classified purely by its start.
export function isOngoing(segment: Pick<Segment, 'startsAt' | 'endsAt'>, today: Date): boolean {
  if (!segment.startsAt || !segment.endsAt) return false;
  const start = startOfLocalDay(segment.startsAt);
  const end = startOfLocalDay(segment.endsAt);
  const ref = startOfLocalDay(today);
  return start < ref && end >= ref;
}

// Classifies every bucket and assigns 1-based day numbers. The day
// number is the bucket's index in chronological order, independent of
// its temporal position — collapsing past days must not renumber the
// trip.
export function classifyDays(days: DayBucket[], today: Date): ClassifiedDay[] {
  return days.map((day, i) => ({
    ...day,
    dayNumber: i + 1,
    position: classifyDay(day.date, today),
  }));
}

// Splits classified days into the leading run that may collapse and
// the remainder that must render expanded.
//
// `collapsed` is the *leading contiguous run* of day buckets that are
// both (a) dated before today and (b) free of any segment ongoing as of
// today. The first bucket that is today/future — or that holds an
// ongoing segment — ends the run; that bucket and everything after it
// land in `visible`.
//
// Consequence: a genuinely-past day that falls after the earliest
// ongoing segment's start day stays in `visible` too. That is intended
// — it belongs to the current live stretch, and it keeps the collapsed
// group a single contiguous pill. Non-contiguous past runs are not
// collapsed.
//
// Days that take a `today` or `future` position never collapse — the
// run ends at the first such day. There is no requirement for a `today`
// anchor to exist: a trip made up entirely of `past` days (with no
// ongoing segment) collapses *every* day into `collapsed`, leaving
// `visible` empty. A trip with no `past` days yields an empty
// `collapsed` instead.
//
// Typed structurally — it needs only a `position` and the day's
// `segments` — so both the server-side `ClassifiedDay` and the client's
// serialised `ItineraryDay` flow through unchanged.
export function splitCollapsedDays<
  D extends { position: DayPosition; segments: Pick<Segment, 'startsAt' | 'endsAt'>[] },
>(days: D[], today: Date): { collapsed: D[]; visible: D[] } {
  let runEnd = 0;
  for (const day of days) {
    if (day.position !== 'past') break;
    if (day.segments.some((s) => isOngoing(s, today))) break;
    runEnd += 1;
  }
  return { collapsed: days.slice(0, runEnd), visible: days.slice(runEnd) };
}

// Resolves which day (by its stable `key`) owns a given segment id.
// Used by the itinerary's deep-link path: a `#seg-<id>` hash may point
// at a segment inside a past day that defaults to collapsed, and the
// owning day has to be force-expanded before the scroll target exists
// in the DOM. Returns null when no day contains the id (stale hash,
// deleted segment) — the caller then falls back to default state.
export function findDayKeyForSegment<D extends { key: string; segments: Segment[] }>(
  days: D[],
  segmentId: string,
): string | null {
  for (const day of days) {
    if (day.segments.some((s) => s.id === segmentId)) return day.key;
  }
  return null;
}

// True when any of the given days contains the segment id. The
// single-group collapsed-past model only needs a boolean — "is the
// deep-linked segment somewhere in the past span?" — so it can decide
// whether to force-expand the one combined past group, rather than the
// per-day key `findDayKeyForSegment` returns.
export function daysContainSegment<D extends { segments: Segment[] }>(
  days: D[],
  segmentId: string,
): boolean {
  return days.some((day) => day.segments.some((s) => s.id === segmentId));
}

// Up to two distinct location names drawn from a day's segments, in
// segment order, used as the collapsed pill's "where" summary (e.g.
// "Paris" or "Paris, Versailles"). Segments without a `locationName`
// (notes, untagged flights) are skipped. Returns null when the day has
// no usable location — the pill then renders date + count only.
export function summariseLocations(segments: Segment[]): string | null {
  const seen = new Set<string>();
  for (const s of segments) {
    const name = s.locationName?.trim();
    if (name) seen.add(name);
    if (seen.size === 2) break;
  }
  if (seen.size === 0) return null;
  return Array.from(seen).join(', ');
}
