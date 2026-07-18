import type { LinkedDocument } from '@/lib/documents';
import type { Segment } from '@/lib/segments';

import { SegmentCard } from './segment-card';
import { SegmentRowSurface } from './segment-row-surface';

interface SegmentRowProps {
  segment: Segment;
  tripId: string;
  // Documents linked to this segment, rendered as chips in the card's
  // footer. Empty / omitted suppresses the footer. The page fetches a
  // trip-wide map (one query) and passes the per-segment slice here.
  linkedDocuments?: LinkedDocument[];
  /**
   * Cached coordinates for this segment, when the geocode_cache has
   * resolved them. Drives the Plus Code badge on the card. Same
   * trip-wide-map-then-per-segment pattern as `linkedDocuments`.
   */
  coords?: { lat: number; lng: number; city?: string | null } | null;
  // When true and the segment is an activity or food, render a "schedule"
  // / "reschedule" action alongside delete. Off on the itinerary view
  // (the date is implicit from the day group); on for the Activities and
  // Food tabs where state-change is a primary action.
  showScheduleAction?: boolean;
  // Show the segment's own date in the card meta. On for the flat
  // Activity / Food tabs (no day-group header there); off for the
  // day-grouped itinerary / type tabs. Forwarded to SegmentCard.
  showDate?: boolean;
}

// A SegmentCard plus its interactive layer (the read-only info dialog and the
// edit / schedule / delete cluster). The card is server-rendered; the
// interactive layer is mounted client-only by SegmentRowSurface so its Radix
// dialogs stay out of SSR and can't drift the useId counter — see that file
// and #68.
export function SegmentRow({
  segment,
  tripId,
  linkedDocuments,
  coords,
  showScheduleAction = false,
  showDate = false,
}: SegmentRowProps) {
  return (
    // `id="seg-<id>"` is the deep-link target for the Cmd+K palette;
    // `scroll-mt-24` keeps the row clear of the sticky topbar when the
    // browser scrolls to the anchor. The flash animation hooks via the
    // data-seg-flash attribute set by use-segment-scroll-flash.
    <div id={`seg-${segment.id}`} className="relative scroll-mt-24">
      <SegmentRowSurface
        segment={segment}
        tripId={tripId}
        linkedDocuments={linkedDocuments}
        coords={coords}
        showScheduleAction={showScheduleAction}
        card={
          <SegmentCard
            segment={segment}
            linkedDocuments={linkedDocuments}
            coords={coords}
            showDate={showDate}
          />
        }
      />
    </div>
  );
}
