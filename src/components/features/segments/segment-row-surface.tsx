'use client';

import { CalendarClock, Pencil } from 'lucide-react';
import type * as React from 'react';

import { useMounted } from '@/components/client-only';
import type { LinkedDocument } from '@/lib/documents';
import type { Segment } from '@/lib/segments';

import { ScheduleActivityDialog } from './schedule-activity-dialog';
import { SegmentDeleteButton } from './segment-delete-button';
import { SegmentFormDialog } from './segment-form-dialog';
import { SegmentInfoDialog } from './segment-info-dialog';

interface SegmentRowSurfaceProps {
  segment: Segment;
  tripId: string;
  linkedDocuments?: LinkedDocument[];
  coords?: { lat: number; lng: number } | null;
  showScheduleAction: boolean;
  // The card content, rendered by the parent server component so SegmentCard
  // stays a Server Component. Shown bare until mount, then wrapped as the
  // info-dialog trigger.
  card: React.ReactNode;
}

// Mounts SegmentRow's interactive layer — the read-only info dialog plus the
// edit / schedule / delete cluster — only on the client.
//
// All four are Radix Dialogs, and each claims an id from React's useId
// counter for its trigger↔content aria wiring. That counter drifts by a fixed
// offset between the server and client renders of the trip tab pages (an
// async boundary on the RSC page shifts it), so SSR-ing the dialogs produced
// an `aria-controls` hydration mismatch on every segment row (#68). Keeping
// the dialogs out of SSR removes the drift source outright: the server — and
// the matching first client paint — render only the static card, and the
// dialogs attach on mount with ids that exist solely on the client, so there
// is nothing for them to mismatch against.
export function SegmentRowSurface({
  segment,
  tripId,
  linkedDocuments,
  coords,
  showScheduleAction,
  card,
}: SegmentRowSurfaceProps) {
  const mounted = useMounted();
  if (!mounted) return <>{card}</>;

  return (
    <>
      {/*
        The card surface itself is the open trigger for a read-only info
        dialog. The dialog wrapper handles click filtering — any click that
        lands on the action cluster (sibling, not a descendant) is naturally
        ignored, and clicks on document chips inside the card body are
        detected via closest('a, button') so the chips keep their default
        navigation behaviour.
      */}
      <SegmentInfoDialog
        segment={segment}
        tripId={tripId}
        linkedDocuments={linkedDocuments}
        coords={coords}
      >
        {card}
      </SegmentInfoDialog>
      {/*
        Actions are absolutely positioned in the card's top-right so they
        don't compete with the card's own meta area. They're always visible —
        disappearing them behind hover would hide them from touch users
        entirely. Each Radix Dialog sibling carries an explicit `key` so
        React's reconciliation never pairs the wrong siblings across renders.
      */}
      <div className="absolute top-3 right-3 flex items-center gap-0.5">
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
                // 44px touch hit-area; the glyph is unboxed, so the larger
                // target stays invisible. Shrinks to 28px on pointer devices.
                className="text-foreground/40 [@media(hover:hover)]:hover:text-foreground/85 inline-flex size-11 items-center justify-center rounded-full transition-colors [@media(hover:hover)]:size-7"
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
          coords={coords}
          trigger={
            <button
              type="button"
              aria-label={`Edit ${segment.type}`}
              // Edit is the primary maintenance action — a persistent pill
              // behind the glyph (vs the muted icon-only delete / reschedule)
              // makes it discoverable without a hover-only reveal. The button
              // is the 44px touch hit-area; the visible pill is the inner
              // span, held at 28px so the cluster looks identical on phone and
              // pointer.
              className="group/edit inline-flex size-11 items-center justify-center [@media(hover:hover)]:size-7"
            >
              <span className="border-foreground/15 bg-card/70 text-foreground/70 [@media(hover:hover)]:group-hover/edit:bg-card [@media(hover:hover)]:group-hover/edit:text-foreground [@media(hover:hover)]:group-hover/edit:border-foreground/30 inline-flex size-7 items-center justify-center rounded-full border transition-colors">
                <Pencil className="size-3.5" strokeWidth={1.75} />
              </span>
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
    </>
  );
}
