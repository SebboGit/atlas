import { Badge } from '@/components/ui/badge';
import type { LinkedDocument } from '@/lib/documents';
import type { PlaceCoordsEntry } from '@/lib/geocoding/types';
import type { Segment } from '@/lib/segments';
import { cn } from '@/lib/utils';

import { DayContinuations } from './continuation-row';
import type { DayPosition } from './day-temporal';
import { SegmentRow } from './segment-row';
import { DayTypeCounts } from './day-type-counts';

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
  coordsBySegmentId?: Map<string, PlaceCoordsEntry>;
  // Temporal position relative to today. Drives the header's "Today"
  // marker. Defaults to 'future' so the type-specific tabs and any
  // other caller that doesn't classify days render unchanged.
  position?: DayPosition;
  // Ongoing multi-day stays that checked in on an earlier day and run
  // through this one — rendered as quiet continuation rows above the
  // day's own segments. Empty / omitted renders nothing extra, so the
  // type-specific tabs (which never pass it) are unaffected.
  continuations?: Segment[];
  // The day's `YYYY-MM-DD` key — forwarded to the continuation rows so
  // the check-out time surfaces on the stay's final day. Set by every
  // itinerary day; the type-specific tabs omit it.
  dayKey?: string;
  // Fired when a continuation row is tapped — lets ItineraryDayList
  // re-open the collapsed past group and re-flash the linked card on
  // every tap, not just the first (see ContinuationRow). Omitted by the
  // type-specific tabs, which never render continuations.
  onContinuationActivate?: () => void;
}

function formatDayLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// One day of the itinerary as a single card: a header (date, day number,
// Today badge, a tally of the day's segment types) over the day's tickets,
// each a bordered ticket of its own with the stub and details joined.
// Today's card carries the coral ring.
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
  const isToday = position === 'today';
  const isPast = position === 'past';

  return (
    <section
      aria-label={`Day ${dayNumber}, ${formatDayLabel(date)}`}
      className={cn(
        'bg-card mb-4 overflow-hidden rounded-[1.25rem] border sm:mb-5',
        isToday ? 'border-primary ring-primary ring-2' : 'border-border',
      )}
    >
      <header className="border-border flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-3 sm:px-5 sm:py-3.5">
        <h2
          className={cn(
            'font-display text-xl leading-none sm:text-2xl',
            isPast ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {formatDayLabel(date)}
        </h2>
        <span className="text-muted-foreground font-mono text-[11px] tracking-[0.08em] uppercase">
          Day {dayNumber}
        </span>
        {isToday && (
          <Badge variant="primary" size="sm">
            Today
          </Badge>
        )}
        <DayTypeCounts segments={segments} className="ml-auto" />
      </header>

      {/* Ongoing stays that checked in earlier and run through this day. */}
      {continuations.length > 0 && (
        <DayContinuations
          continuations={continuations}
          dayKey={dayKey ?? ''}
          onActivate={onContinuationActivate}
        />
      )}

      {/* A day with nothing scheduled and no stay spanning it — possible
       *  since the itinerary fills the trip's full calendar. */}
      {segments.length === 0 && continuations.length === 0 && (
        <p className="text-muted-foreground px-4 py-3 font-mono text-[11px] tracking-[0.08em] uppercase sm:px-5">
          No plans
        </p>
      )}

      {segments.length > 0 && (
        <ol
          className={cn(
            'flex flex-col gap-2 p-2 sm:gap-2.5 sm:p-3',
            continuations.length > 0 && 'border-border border-t',
            // Inside a day each segment reads as one bordered ticket — the
            // tone stub and its details joined by a plain seam, with no
            // perforation or notches. (Free-standing tickets on the type
            // tabs keep both.)
            '[--color-perforation:transparent] [--ticket-notch:transparent] [&_.ticket]:rounded-xl [&_.ticket]:shadow-none',
          )}
        >
          {segments.map((s) => (
            <li key={s.id} className="relative">
              <SegmentRow
                segment={s}
                tripId={tripId}
                linkedDocuments={linkedDocumentsBySegment?.get(s.id)}
                coords={coordsBySegmentId?.get(s.id) ?? null}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
