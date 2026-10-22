import type { Segment, SegmentType } from '@/lib/segments';
import { cn } from '@/lib/utils';

import { SEGMENT_SWATCH } from './segment-tone';

const ORDER: readonly SegmentType[] = ['flight', 'transit', 'hotel', 'activity', 'food', 'note'];

const NOUN: Record<SegmentType, [string, string]> = {
  flight: ['flight', 'flights'],
  transit: ['transit', 'transit'],
  hotel: ['hotel', 'hotels'],
  activity: ['activity', 'activities'],
  food: ['food', 'food'],
  note: ['note', 'notes'],
};

export function countByType(segments: Segment[]): Array<{ type: SegmentType; count: number }> {
  const counts = new Map<SegmentType, number>();
  for (const s of segments) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  return ORDER.filter((t) => counts.has(t)).map((type) => ({ type, count: counts.get(type)! }));
}

// A day's shape at a glance: one tone swatch per type with its count. Phone
// shows the swatches alone (the label is in the accessible name); `sm:` up
// adds the words.
export function DayTypeCounts({
  segments,
  className,
}: {
  segments: Segment[];
  className?: string;
}) {
  const counts = countByType(segments);
  if (counts.length === 0) return null;
  const label = counts
    .map(({ type, count }) => `${count} ${NOUN[type][count === 1 ? 0 : 1]}`)
    .join(', ');

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="sr-only">{label}</span>
      {counts.map(({ type, count }) => (
        <span
          key={type}
          aria-hidden
          className="bg-muted text-foreground inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] uppercase"
        >
          <span className={cn('size-2 rounded-[3px]', SEGMENT_SWATCH[type])} />
          {count}
          <span className="hidden sm:inline">{NOUN[type][count === 1 ? 0 : 1]}</span>
        </span>
      ))}
    </div>
  );
}
