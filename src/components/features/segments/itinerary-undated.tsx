import type { LinkedDocument } from '@/lib/documents';
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
  coordsBySegmentId?: Map<string, { lat: number; lng: number }>;
}

// The itinerary's "Undated" section — undated notes (and transit) that have
// no day to file under. Rendered after the day list as a quiet appendix: a
// note with no date is a general trip reminder, not a timed event, so it
// reads as a footer to the timeline rather than a day in it.
//
// Deliberately simpler than DayGroup: no day header, no timeline rail or
// dot markers (those imply temporal sequence, which undated items have
// none of). Cards keep the same `md:pl-10` inset so their left edge lines
// up with the dated days above. Renders nothing when empty, so the page
// can always mount it unconditionally.
export function ItineraryUndated({
  segments,
  tripId,
  linkedDocumentsBySegment,
  coordsBySegmentId,
}: ItineraryUndatedProps) {
  if (segments.length === 0) return null;

  return (
    <section className="mb-8 sm:mb-10">
      <header className="mb-4 flex items-baseline gap-3 sm:mb-5">
        <p className="text-foreground/85 font-mono text-xs tracking-[0.18em] uppercase sm:tracking-[0.28em]">
          Undated
        </p>
        <span aria-hidden className="bg-foreground/20 h-px flex-1" />
      </header>

      <div className="md:pl-10">
        <ol className="space-y-3 sm:space-y-4">
          {segments.map((s) => (
            <li key={s.id}>
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
