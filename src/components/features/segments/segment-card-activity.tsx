import { Sparkles } from 'lucide-react';

import type { LinkedDocument } from '@/lib/documents';
import type { Segment } from '@/lib/segments';
import { activityDataSchema } from '@/lib/segments';

import { LinkedDocumentChips } from './linked-document-chips';
import { segmentCity } from './segment-city';
import { subtitleWithPlusCodeBadge } from './plus-code-badge';
import { SegmentCardShell } from './segment-card-shell';
import { SegmentTimeMeta } from './segment-time-meta';

export function SegmentCardActivity({
  segment,
  linkedDocuments = [],
  coords,
  showDate = false,
}: {
  segment: Segment;
  linkedDocuments?: LinkedDocument[];
  /** Cached coordinates, if any — drive the Plus Code badge + deep link. */
  coords?: { lat: number; lng: number; city?: string | null } | null;
  /**
   * On the flat Activities tab the card carries its own date (no
   * day-group header there); the itinerary leaves it off. See
   * SegmentTimeMeta.
   */
  showDate?: boolean;
}) {
  const parse = activityDataSchema.safeParse(segment.data);
  const title = parse.success ? parse.data.title : 'Activity';
  const description = parse.success ? parse.data.description : undefined;

  // ADR-0003: a NULL startsAt on an activity is the undated state. On the
  // flat Activities tab (like Food) a dated and an undated activity sit in
  // one list — the date+time meta distinguishes them, no badge needed.
  const meta = (
    <SegmentTimeMeta startsAt={segment.startsAt} endsAt={segment.endsAt} showDate={showDate} />
  );

  const subtitle = subtitleWithPlusCodeBadge({
    parts: [segment.locationName, segmentCity(coords, segment.locationName), description],
    coords,
    venue: title,
  });

  return (
    <SegmentCardShell
      type="activity"
      glyph={<Sparkles className="size-4" strokeWidth={1.5} />}
      typeLabel="Activity"
      title={title}
      subtitle={subtitle}
      meta={meta}
      footer={
        linkedDocuments.length > 0 ? <LinkedDocumentChips documents={linkedDocuments} /> : undefined
      }
      needsReview={segment.needsReview}
    />
  );
}
