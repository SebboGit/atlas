import type { Segment } from '@/lib/segments';

// UTC calendar-day key. Non-flight segment times are floating-UTC
// wall-clocks (ADR-0014), so the day a segment "reads" is its UTC
// calendar day — not the server's local interpretation of the instant.
// Reading in UTC keeps grouping identical on any server timezone
// (dev/prod parity). Exported so the itinerary's collapse persistence
// can key its localStorage overrides off the same value.
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
  return { days, unscheduled };
}
