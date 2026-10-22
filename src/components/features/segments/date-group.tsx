import type { LinkedDocument } from '@/lib/documents';
import type { PlaceCoordsEntry } from '@/lib/geocoding/types';
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
  coordsBySegmentId?: Map<string, PlaceCoordsEntry>;
  // Forwarded to SegmentRow — surfaces the reschedule affordance on
  // activity / food cards. The flat Activity and Food tabs render rows
  // directly (not via DateGroup), so today this stays off here; kept for
  // any future day-grouped surface that wants it.
  showScheduleAction?: boolean;
}

function formatDayLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Quiet date-grouping header for the type-specific tabs (Flights,
// Hotels, Activities). Unlike the itinerary's DayGroup there is no day
// card and no "Day N" — filtered views aren't a sequential walk of the
// trip — so each segment stays a free-standing ticket under its date.
export function DateGroup({
  date,
  segments,
  tripId,
  linkedDocumentsBySegment,
  coordsBySegmentId,
  showScheduleAction = false,
}: DateGroupProps) {
  const label = date ? formatDayLabel(date) : 'Undated';
  return (
    <section className="mb-8 sm:mb-10">
      <header className="mb-3 sm:mb-4">
        <h2 className="font-display text-foreground text-xl sm:text-2xl">{label}</h2>
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
