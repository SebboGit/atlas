import type { Segment } from '@/lib/segments';

// Local-date key so segments in the same calendar day group together
// regardless of timezone offset. The choice is "local to the server"
// — good enough for a single-user homelab; can revisit if/when trips
// cross hemispheres in production. Exported so the itinerary's collapse
// persistence can key its localStorage overrides off the same value.
export function dayKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export interface DayBucket {
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
      const date = new Date(s.startsAt);
      date.setHours(0, 0, 0, 0);
      bucket = { date, segments: [] };
      map.set(key, bucket);
    }
    bucket.segments.push(s);
  }
  const days = Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  return { days, unscheduled };
}
