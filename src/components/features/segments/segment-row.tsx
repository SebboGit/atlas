import { CalendarClock, Pencil } from 'lucide-react';

import type { LinkedDocument } from '@/lib/documents';
import type { Segment } from '@/lib/segments';

import { ScheduleActivityDialog } from './schedule-activity-dialog';
import { SegmentCard } from './segment-card';
import { SegmentDeleteButton } from './segment-delete-button';
import { SegmentFormDialog } from './segment-form-dialog';
import { SegmentInfoDialog } from './segment-info-dialog';

interface SegmentRowProps {
  segment: Segment;
  tripId: string;
  // Documents linked to this segment, rendered as chips in the card's
  // footer. Empty / omitted suppresses the footer. The page fetches a
  // trip-wide map (one query) and passes the per-segment slice here.
  linkedDocuments?: LinkedDocument[];
  // When true and the segment is an activity, render a "schedule" /
  // "reschedule" action alongside delete. Off on the itinerary view
  // (the date is implicit from the day group); on for the Activities
  // tab where state-change is a primary action.
  showScheduleAction?: boolean;
}

// Wraps a SegmentCard with a small actions cluster (delete, optionally
// schedule). Actions are absolutely positioned in the card's top-right
// so they don't compete with the card's own meta area on the right.
// They're always visible — subtle ink-tint icons sit comfortably in
// the warm-sand palette and disappearing them behind hover would hide
// them from touch users entirely.
export function SegmentRow({
  segment,
  tripId,
  linkedDocuments,
  showScheduleAction = false,
}: SegmentRowProps) {
  return (
    // `id="seg-<id>"` is the deep-link target for the Cmd+K palette;
    // `scroll-mt-24` keeps the row clear of the sticky topbar when the
    // browser scrolls to the anchor. The flash animation hooks via the
    // data-seg-flash attribute set by use-segment-scroll-flash.
    <div id={`seg-${segment.id}`} className="relative scroll-mt-24">
      {/*
        The card surface itself is the open trigger for a read-only
        info dialog. The dialog wrapper handles click filtering — any
        click that lands on the action cluster (sibling, not a
        descendant) is naturally ignored, and clicks on document
        chips inside the card body are detected via closest('a, button')
        so the chips keep their default navigation behaviour.
      */}
      <SegmentInfoDialog segment={segment} linkedDocuments={linkedDocuments}>
        <SegmentCard segment={segment} linkedDocuments={linkedDocuments} />
      </SegmentInfoDialog>
      <div className="absolute top-3 right-3 flex items-center gap-0.5">
        {/*
          Every Radix Dialog sibling in this cluster carries an
          explicit `key`. Without all three keyed, React's mixed
          keys-and-position reconciliation can pair the wrong
          siblings across renders — the symptom is a structurally-
          similar Dialog "absorbing" its neighbour's trigger content,
          which manifests as the Edit pencil vanishing after tab
          navigation when the schedule slot was present on one route
          but absent on the next (activity on Activities tab vs the
          same activity on Itinerary). See
          [[bug-segment-row-hydration-mismatch]] — same root cause,
          extended past the SSR symptom to post-navigation renders.
        */}
        {showScheduleAction && segment.type === 'activity' && (
          <ScheduleActivityDialog
            key="schedule"
            tripId={tripId}
            segmentId={segment.id}
            currentStart={segment.startsAt}
            trigger={
              <button
                type="button"
                aria-label={segment.startsAt ? 'Reschedule activity' : 'Schedule activity'}
                className="text-foreground/40 hover:text-foreground/85 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors"
              >
                <CalendarClock className="size-3.5" strokeWidth={1.5} />
              </button>
            }
          />
        )}
        <SegmentFormDialog
          key="edit"
          tripId={tripId}
          editingSegment={segment}
          trigger={
            <button
              type="button"
              aria-label={`Edit ${segment.type}`}
              // Edit is the primary maintenance action and should
              // read as such — a persistent pill behind the glyph
              // (vs the muted icon-only treatment of delete /
              // reschedule) makes the affordance discoverable
              // without resorting to hover-only reveal, which would
              // hide it from touch users.
              className="border-foreground/15 bg-card/70 text-foreground/70 hover:bg-card hover:text-foreground hover:border-foreground/30 inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors"
            >
              <Pencil className="size-3.5" strokeWidth={1.75} />
            </button>
          }
        />
        <SegmentDeleteButton
          key="delete"
          tripId={tripId}
          segmentId={segment.id}
          noun={segment.type}
        />
      </div>
    </div>
  );
}
