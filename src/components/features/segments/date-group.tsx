import type { LinkedDocument } from '@/lib/documents';
import type { Segment } from '@/lib/segments';

import { SegmentRow } from './segment-row';

interface DateGroupProps {
  // null label renders "Undated" — used to surface the rare segment
  // that slipped in without a startsAt rather than hiding it.
  date: Date | null;
  segments: Segment[];
  tripId: string;
  linkedDocumentsBySegment?: Map<string, LinkedDocument[]>;
  /** Trip-wide segmentId → cached coordinates map. Drives the Plus Code badge. */
  coordsBySegmentId?: Map<string, { lat: number; lng: number }>;
  // Forwarded to SegmentRow — Activities tab uses this so the
  // reschedule affordance sits on each card.
  showScheduleAction?: boolean;
}

function formatDayLabel(d: Date): string {
  return d
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .toUpperCase();
}

// Quiet date-grouping header for the type-specific tabs (Flights,
// Hotels, Activities). Same eyebrow/hairline rhythm as the
// itinerary's DayGroup, but drops the "Day NN" sequence number
// (filtered views aren't a sequential walk of the trip) and the
// timeline rail with dot markers (no implied progression — just a
// date grouping so the user can tell which day each card is on).
export function DateGroup({
  date,
  segments,
  tripId,
  linkedDocumentsBySegment,
  coordsBySegmentId,
  showScheduleAction = false,
}: DateGroupProps) {
  const label = date ? formatDayLabel(date) : 'UNDATED';
  return (
    <section className="mb-8 sm:mb-10">
      <header className="mb-4 flex items-baseline gap-3 sm:mb-5">
        <p className="text-foreground font-mono text-xs tracking-[0.2em] uppercase">{label}</p>
        <span aria-hidden className="bg-foreground/20 h-px flex-1" />
      </header>
      <ul className="space-y-3 sm:space-y-4">
        {segments.map((s) => (
          <li key={s.id}>
            <SegmentRow
              segment={s}
              tripId={tripId}
              linkedDocuments={linkedDocumentsBySegment?.get(s.id)}
              coords={coordsBySegmentId?.get(s.id) ?? null}
              showScheduleAction={showScheduleAction}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
