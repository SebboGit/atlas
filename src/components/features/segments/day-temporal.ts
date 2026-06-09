import type { Segment } from '@/lib/segments';

import { type DayBucket } from './group-by-day';

// Where a calendar day sits relative to "now". Past days are reference
// material, today is the focus, future days are a preview — the
// collapsed-itinerary pattern (issue #8) and the chronological-map
// rail (issue #9) both lean on this single classification so the two
// surfaces stay in agreement about what "past" means.
export type DayPosition = 'past' | 'today' | 'future';

// Midnight (local) of the given date. `groupSegmentsByDay` already
// normalises bucket dates to local midnight, but callers passing a raw
// `new Date()` need this to compare on calendar-day boundaries. Exported
// so `continuationCheckOutTime` can match the check-out day on the SAME
// local-day basis the continuation gating (`continuesThroughDay`) uses.
export function startOfLocalDay(d: Date): number {
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

// Splits classified days into the leading run that collapses and the
// remainder that renders expanded.
//
// `collapsed` is every `past` day (they always form the leading run —
// past days sort before today/future). The first `today`/`future` day
// ends the run; it and everything after land in `visible`.
//
// Past days collapse UNCONDITIONALLY — a fully-concluded single-day
// event (a past day hike) is reference material even if some unrelated
// multi-day stay happens to span its date. A stay still ongoing today
// is NOT kept visible by force-expanding its check-in day (which would
// drag every later past day along to stay contiguous); instead it is
// surfaced as a continuation under today + the future days it spans —
// see `ongoingContinuationsByDayKey`. That keeps the past a clean pill
// AND keeps the current stay visible where you are.
//
// A trip made entirely of `past` days collapses every day, leaving
// `visible` empty; a trip with no `past` days yields an empty
// `collapsed`. Typed structurally on `position` only, so both the
// server-side `ClassifiedDay` and the client's serialised `ItineraryDay`
// flow through unchanged.
export function splitCollapsedDays<D extends { position: DayPosition }>(
  days: D[],
): { collapsed: D[]; visible: D[] } {
  let runEnd = 0;
  for (const day of days) {
    if (day.position !== 'past') break;
    runEnd += 1;
  }
  return { collapsed: days.slice(0, runEnd), visible: days.slice(runEnd) };
}

// True when a segment spans `dayDate` from an EARLIER check-in: it began
// strictly before that calendar day and ends on or after it. A
// single-day or open-ended segment (missing either endpoint) never
// continues. This is the per-day test behind surfacing a multi-day stay
// on the days after its check-in.
export function continuesThroughDay(
  segment: Pick<Segment, 'startsAt' | 'endsAt'>,
  dayDate: Date,
): boolean {
  if (!segment.startsAt || !segment.endsAt) return false;
  const start = startOfLocalDay(segment.startsAt);
  const end = startOfLocalDay(segment.endsAt);
  const day = startOfLocalDay(dayDate);
  return start < day && end >= day;
}

// For each TODAY/FUTURE day, the segments that continue through it from a
// COLLAPSED (past) check-in bucket — the "you're still here"
// continuations to surface once the past collapses. Keyed by the day's
// stable `dayKey`.
//
// Position-driven, NOT clock-driven: a segment qualifies iff its check-in
// day is `past` (so its primary card collapsed) and it `continuesThroughDay`
// the visible day. The server-set `position` is the exact signal
// `splitCollapsedDays` reads, so a continuation can never disagree with
// the split — no `today` input, no client/server clock-skew window. A
// segment never appears as a continuation on its own check-in day, and
// none are emitted for `past` days (they're collapsed).
//
// The itinerary's `continuationsByDayKey` mirrors this over the serialised
// `ItineraryDay` shape; this variant runs over the rail's `ClassifiedDay`.
export function ongoingContinuationsByDayKey(days: ClassifiedDay[]): Map<string, Segment[]> {
  const fromCollapsed: Array<{ seg: Segment; bucketKey: string }> = [];
  for (const day of days) {
    if (day.position !== 'past') continue;
    const k = day.key;
    for (const seg of day.segments) fromCollapsed.push({ seg, bucketKey: k });
  }
  if (fromCollapsed.length === 0) return new Map();

  const byDay = new Map<string, Segment[]>();
  for (const day of days) {
    if (day.position === 'past') continue;
    const k = day.key;
    const conts: Segment[] = [];
    for (const { seg, bucketKey } of fromCollapsed) {
      if (bucketKey === k) continue;
      if (continuesThroughDay(seg, day.date)) conts.push(seg);
    }
    if (conts.length > 0) byDay.set(k, conts);
  }
  return byDay;
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
