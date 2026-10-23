import type { LinkedDocument } from '@/lib/documents';
import type { PlaceCoordsEntry } from '@/lib/geocoding/types';
import type { Segment } from '@/lib/segments';

import { SegmentRow } from './segment-row';

interface ItineraryUndatedProps {
  // Undated (`startsAt === null`) segments to surface on the itinerary.
  // Scoped by the page to `note` and `transit` — the only types with no
  // dedicated tab, so an undated one of these would otherwise be invisible.
  // Undated activities / food deliberately stay on their own flat tabs
  // (ADR-0003) and are NOT passed here.
  segments: Segment[];
  tripId: string;
  linkedDocumentsBySegment?: Map<string, LinkedDocument[]>;
  /** Trip-wide segmentId → cached coordinates map. Drives the Plus Code badge. */
  coordsBySegmentId?: Map<string, PlaceCoordsEntry>;
}

// The itinerary's "Undated" section — undated notes (and transit) that have
// no day to file under. Rendered after the day list as a quiet appendix: a
// note with no date is a general trip reminder, not a timed event, so it
// reads as a footer to the timeline rather than a day in it.
//
// Same card as a DayGroup, with a plain "Undated" header and no day number
// or type counts (no temporal sequence to imply). Renders nothing when
// empty, so the page can always mount it unconditionally.
export function ItineraryUndated({
  segments,
  tripId,
  linkedDocumentsBySegment,
  coordsBySegmentId,
}: ItineraryUndatedProps) {
  if (segments.length === 0) return null;

  return (
    <section
      aria-labelledby="itinerary-undated"
      className="bg-card border-border mb-4 overflow-hidden rounded-[1.25rem] border sm:mb-5"
    >
      <header className="border-border flex items-baseline gap-3 border-b px-4 py-3 sm:px-5 sm:py-3.5">
        <h2 id="itinerary-undated" className="font-display text-foreground text-xl sm:text-2xl">
          Undated
        </h2>
        <span className="text-muted-foreground font-mono text-[11px] tracking-[0.06em] uppercase">
          Not scheduled
        </span>
      </header>
      {/* Same bordered tickets as a DayGroup. */}
      <ol className="flex flex-col gap-2 p-2 [--color-perforation:transparent] [--ticket-notch:transparent] sm:gap-2.5 sm:p-3 [&_.ticket]:rounded-xl [&_.ticket]:shadow-none">
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
    </section>
  );
}
