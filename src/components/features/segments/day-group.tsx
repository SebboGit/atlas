import type { LinkedDocument } from '@/lib/documents';
import type { Segment } from '@/lib/segments';
import { cn } from '@/lib/utils';

import type { DayPosition } from './day-temporal';
import { SegmentRow } from './segment-row';

interface DayGroupProps {
  dayNumber: number;
  date: Date;
  segments: Segment[];
  tripId: string;
  // Trip-wide map of segmentId → linked documents. The page fetches
  // it once and passes the same reference to every day; each segment
  // looks itself up here. Empty/undefined falls through to no chips.
  linkedDocumentsBySegment?: Map<string, LinkedDocument[]>;
  // Temporal position relative to today. Drives the header's "Today"
  // marker. Defaults to 'future' so the type-specific tabs and any
  // other caller that doesn't classify days render unchanged.
  position?: DayPosition;
}

function formatDayLabel(d: Date): string {
  return d
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .toUpperCase();
}

// One day of the itinerary. Eyebrow ruled header — Day NN and the
// date grouped on the left, with a hairline running to the right
// edge for visual rhythm. On laptop, the children are inset and a
// thin vertical timeline rail with dot markers runs alongside; on
// mobile the rail is dropped and cards go full width.
//
// The header optionally carries a "Today" marker (when `position` is
// 'today').
export function DayGroup({
  dayNumber,
  date,
  segments,
  tripId,
  linkedDocumentsBySegment,
  position = 'future',
}: DayGroupProps) {
  const dayLabel = String(dayNumber).padStart(2, '0');
  const isToday = position === 'today';

  return (
    <section className="mb-8 sm:mb-10">
      <header className="mb-4 flex items-baseline gap-3 sm:mb-5">
        <p
          className={cn(
            'font-mono text-xs tracking-[0.28em] uppercase',
            isToday ? 'text-primary' : 'text-foreground',
          )}
        >
          Day {dayLabel}
          <span aria-hidden className="text-foreground/30 mx-2">
            ·
          </span>
          <span className="tracking-[0.2em]">{formatDayLabel(date)}</span>
        </p>
        {isToday && (
          <span className="bg-primary/12 text-primary border-primary/25 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.2em] uppercase">
            Today
          </span>
        )}
        <span aria-hidden className="bg-foreground/20 h-px flex-1" />
      </header>

      <ol className="relative space-y-3 sm:space-y-4 md:pl-10">
        {/* Vertical timeline rail — laptop only, sits within the pl-10 gutter. */}
        <span
          aria-hidden
          className="bg-foreground/15 absolute inset-y-8 left-4 hidden w-px md:block"
        />
        {segments.map((s) => (
          <li key={s.id} className="relative">
            {/* Dot marker — also laptop only. Sits at left:16px in the
             *  parent ol, which matches the rail's centre. */}
            <span
              aria-hidden
              className="border-foreground/35 bg-card absolute top-7 hidden h-2 w-2 rounded-full border md:block"
              style={{ left: '-28px' }}
            />
            <SegmentRow
              segment={s}
              tripId={tripId}
              linkedDocuments={linkedDocumentsBySegment?.get(s.id)}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
