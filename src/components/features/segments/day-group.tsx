import { Badge } from '@/components/ui/badge';
import type { LinkedDocument } from '@/lib/documents';
import type { Segment } from '@/lib/segments';
import { cn } from '@/lib/utils';

import { DayContinuations } from './continuation-row';
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
  /**
   * Trip-wide map of segmentId → cached coordinates. Same pattern as
   * `linkedDocumentsBySegment` — single page-side fetch, per-row
   * lookup. Drives the Plus Code badge on each card.
   */
  coordsBySegmentId?: Map<string, { lat: number; lng: number }>;
  // Temporal position relative to today. Drives the header's "Today"
  // marker. Defaults to 'future' so the type-specific tabs and any
  // other caller that doesn't classify days render unchanged.
  position?: DayPosition;
  // Ongoing multi-day stays that checked in on an earlier, collapsed day
  // and run through this one — rendered as quiet continuation rows above
  // the day's own segments. Empty / omitted renders nothing extra, so
  // the type-specific tabs (which never pass it) are unaffected.
  continuations?: Segment[];
  // The day's `YYYY-MM-DD` key — forwarded to the continuation rows so the
  // check-out time surfaces on the stay's final day. Only set on the
  // itinerary's visible days (the only caller that passes continuations).
  dayKey?: string;
  // Fired when a continuation row is tapped — lets ItineraryDayList
  // re-open the collapsed past group and re-flash the linked card on
  // every tap, not just the first (see ContinuationRow). Omitted by the
  // type-specific tabs, which never render continuations.
  onContinuationActivate?: () => void;
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
  coordsBySegmentId,
  position = 'future',
  continuations = [],
  dayKey,
  onContinuationActivate,
}: DayGroupProps) {
  const dayLabel = String(dayNumber).padStart(2, '0');
  const isToday = position === 'today';

  return (
    <section className="mb-8 sm:mb-10">
      <header className="mb-4 flex items-baseline gap-3 sm:mb-5">
        <p
          className={cn(
            'font-mono text-xs tracking-[0.18em] uppercase sm:tracking-[0.28em]',
            isToday ? 'text-primary' : 'text-foreground',
          )}
        >
          Day {dayLabel}
          <span aria-hidden className="text-foreground/30 mx-2">
            ·
          </span>
          <span className="tracking-[0.14em] sm:tracking-[0.2em]">{formatDayLabel(date)}</span>
        </p>
        {isToday && (
          <Badge variant="primary" size="sm" className="bg-primary/10">
            Today
          </Badge>
        )}
        <span aria-hidden className="bg-foreground/20 h-px flex-1" />
      </header>

      {/* Persistent backdrop to the day — ongoing stays that continue
       *  through it — sits above the day's own segments. Inset to align
       *  with the cards' left edge on laptop (matching the ol's pl-10). */}
      {continuations.length > 0 && (
        <div className="md:pl-10">
          <DayContinuations
            continuations={continuations}
            dayKey={dayKey ?? ''}
            onActivate={onContinuationActivate}
          />
        </div>
      )}

      {/* Positioned wrapper holds the decorative timeline rail as a sibling
       *  of the list — the rail is not a valid direct child of <ol>, so it
       *  lives here instead. pl-10 reserves the laptop gutter the rail and
       *  dots sit in. */}
      <div className="relative md:pl-10">
        {/* Vertical timeline rail — laptop only, sits within the pl-10
         *  gutter. Today's rail picks up a faint terracotta wash so the
         *  focal day reads as a connected through-line behind its dots;
         *  other days stay a neutral hairline. */}
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-8 left-4 hidden w-px md:block',
            isToday ? 'bg-primary/30' : 'bg-foreground/15',
          )}
        />
        <ol className="space-y-3 sm:space-y-4">
          {segments.map((s) => (
            <li key={s.id} className="relative">
              {/* Dot marker — also laptop only. Sits at left:-28px on each
               *  row, which matches the rail's centre in the gutter. Today's
               *  rail reads as the single terracotta focal point (filled
               *  dot); every other day stays a quiet hollow ink marker. */}
              <span
                aria-hidden
                className={cn(
                  'absolute top-7 hidden h-2 w-2 rounded-full border md:block',
                  isToday ? 'border-primary bg-primary' : 'border-foreground/35 bg-card',
                )}
                style={{ left: '-28px' }}
              />
              <SegmentRow
                segment={s}
                tripId={tripId}
                linkedDocuments={linkedDocumentsBySegment?.get(s.id)}
                coords={coordsBySegmentId?.get(s.id) ?? null}
              />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
