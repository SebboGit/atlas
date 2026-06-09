import type { Segment } from '@/lib/segments';

// UTC calendar-day key. All segment times are floating-UTC wall-clocks
// (ADR-0014 for non-flight, ADR-0016 for flights), so the day a segment
// "reads" is its UTC calendar day — not the server's local interpretation
// of the instant. Reading in UTC keeps grouping identical on any server
// timezone (dev/prod parity). Exported so the itinerary's collapse
// persistence can key its localStorage overrides off the same value.
export function dayKey(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export interface DayBucket {
  // UTC calendar-day token (`YYYY-MM-DD`) computed from the segment's
  // instant via `dayKey`. Carried on the bucket — rather than re-derived
  // with `dayKey(date)` downstream — so the token (UTC) and the display
  // `date` (local midnight, below) never disagree on a non-UTC server.
  key: string;
  // Local midnight of the UTC calendar day. Day labels
  // (`toLocaleDateString`) and viewer-relative classification
  // (`startOfLocalDay`) read it with LOCAL getters, so it must be a
  // local-midnight Date carrying the right calendar-day digits.
  date: Date;
  segments: Segment[];
}

export interface DayGrouping {
  days: DayBucket[];
  unscheduled: Segment[];
}

// Tiebreaker order for segments that resolve to the same effective time
// within a day (flight first, then movement, where-you-slept, what-you-did,
// annotations). Only decides equal-time ties; it never reorders segments
// that already differ by time. The sort below is stable, so genuine ties of
// the same type fall back to the repo's `createdAt` order.
const DAY_TYPE_RANK: Record<Segment['type'], number> = {
  flight: 0,
  transit: 1,
  hotel: 2,
  activity: 3,
  food: 4,
  note: 5,
};

// Orders one day's segments. Plain chronological order is right except for
// one case: a hotel check-in can't really precede a flight you took the same
// day — you land first, then check in. The stored check-in is usually the
// property's policy open-time (or just a bare date the form parses to 00:00Z),
// not your real arrival, so chronological order can float a hotel above a
// later flight. So a hotel sorts no earlier than the last flight to land that
// day; everything else keeps its own time. With no flight in the day this is a
// no-op and the day stays purely chronological.
function sortDaySegments(segments: Segment[]): void {
  let lastFlightLanding: number | null = null;
  for (const s of segments) {
    if (s.type !== 'flight' || !s.startsAt) continue;
    // Landing = arrival when we have it, else departure (a date-only flight
    // or one with no parsed arrival time).
    const landing = (s.endsAt ?? s.startsAt).getTime();
    lastFlightLanding = lastFlightLanding === null ? landing : Math.max(lastFlightLanding, landing);
  }

  const effectiveTime = (s: Segment): number => {
    // Every segment in a bucket was grouped on a non-null startsAt.
    const own = s.startsAt!.getTime();
    if (s.type === 'hotel' && lastFlightLanding !== null) return Math.max(own, lastFlightLanding);
    return own;
  };

  segments.sort(
    (a, b) => effectiveTime(a) - effectiveTime(b) || DAY_TYPE_RANK[a.type] - DAY_TYPE_RANK[b.type],
  );
}

export function groupSegmentsByDay(segments: Segment[]): DayGrouping {
  const map = new Map<string, DayBucket>();
  const unscheduled: Segment[] = [];
  for (const s of segments) {
    if (!s.startsAt) {
      unscheduled.push(s);
      continue;
    }
    const key = dayKey(s.startsAt);
    let bucket = map.get(key);
    if (!bucket) {
      // Local midnight of the UTC calendar day: same calendar-day digits
      // as `key`, expressed in local time so label/classification (which
      // use local getters) read the day the segment was grouped under.
      const date = new Date(
        s.startsAt.getUTCFullYear(),
        s.startsAt.getUTCMonth(),
        s.startsAt.getUTCDate(),
      );
      bucket = { key, date, segments: [] };
      map.set(key, bucket);
    }
    bucket.segments.push(s);
  }
  const days = Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const day of days) sortDaySegments(day.segments);
  return { days, unscheduled };
}

const DAY_MS = 86_400_000;

// UTC midnight (ms) of the instant's UTC calendar day — the same day
// `dayKey` reads, expressed as a steppable timestamp.
function utcDayStartMs(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Inclusive calendar-day count of a date range, read in UTC (trip dates
// are date-only values stored at UTC midnight). Null when either end is
// missing or the range is inverted — callers fall back to whatever count
// they have.
export function countDaysInclusive(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const span = utcDayStartMs(end) - utcDayStartMs(start);
  if (span < 0) return null;
  return span / DAY_MS + 1;
}

// Fill ceiling. The itinerary renders one DayGroup per filled day, so a
// segment with a typo'd year (2206 instead of 2026) must not explode the
// page into thousands of empty days. Past a year, skip the fill and fall
// back to segment-dated buckets only — the pre-fill behaviour.
const MAX_FILLED_DAYS = 366;

// Expands segment-dated buckets to cover the trip's full calendar span:
// every day from min(trip start, first bucket) through max(trip end,
// last bucket, latest segment end) gets a bucket, empty where nothing is
// scheduled. Day numbers and the itinerary's day count both derive from
// this filled list, so a trip with only a check-in and a return flight
// still reads Day 1 … Day N instead of Day 1, Day 2.
//
// The latest segment `endsAt` extends the range so a multi-day stay on
// an undated trip still surfaces its middle and check-out days. With no
// buckets at all this returns [] — the empty itinerary keeps its empty
// state rather than rendering a run of bare day headers.
export function fillDayRange(
  days: DayBucket[],
  range: { start?: Date | null; end?: Date | null } = {},
): DayBucket[] {
  if (days.length === 0) return days;

  // Buckets are chronological and keyed by UTC day, so their dates
  // (local midnight of that UTC day — see groupSegmentsByDay) step in
  // exact UTC-day increments once re-read as UTC days via their
  // segments. Anchor the walk on the segments' own instants instead of
  // re-parsing key tokens.
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const day of days) {
    for (const s of day.segments) {
      if (!s.startsAt) continue;
      const dayMs = utcDayStartMs(s.startsAt);
      if (dayMs < startMs) startMs = dayMs;
      if (dayMs > endMs) endMs = dayMs;
      if (s.endsAt) endMs = Math.max(endMs, utcDayStartMs(s.endsAt));
    }
  }
  if (range.start) startMs = Math.min(startMs, utcDayStartMs(range.start));
  if (range.end) endMs = Math.max(endMs, utcDayStartMs(range.end));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return days;
  if ((endMs - startMs) / DAY_MS + 1 > MAX_FILLED_DAYS) return days;

  const byKey = new Map(days.map((d) => [d.key, d]));
  const filled: DayBucket[] = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    const utc = new Date(ms);
    const key = dayKey(utc);
    filled.push(
      byKey.get(key) ?? {
        key,
        // Local midnight of the UTC calendar day — same construction as
        // groupSegmentsByDay, so labels/classification read the same day.
        date: new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()),
        segments: [],
      },
    );
  }
  return filled;
}

// Segment types with no dedicated trip tab. An undated (`startsAt === null`)
// one of these would be invisible everywhere — the type tabs don't list it
// and the day-grouped itinerary excludes undated rows — so the itinerary
// surfaces them in its own "Undated" section. Activities and food are
// deliberately excluded: their undated state is a shortlist candidate shown
// on their own flat tabs (ADR-0003), not orphaned.
const UNDATED_ITINERARY_TYPES = new Set<Segment['type']>(['note', 'transit']);

// Narrows a list of undated segments to the ones the itinerary should
// surface (see UNDATED_ITINERARY_TYPES). Extracted from the page so the
// "only note + transit" rule has a regression guard independent of the
// page wiring.
export function surfaceUndatedOnItinerary(segments: Segment[]): Segment[] {
  return segments.filter((s) => UNDATED_ITINERARY_TYPES.has(s.type));
}
