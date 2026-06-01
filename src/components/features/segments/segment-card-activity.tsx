import { Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { LinkedDocument } from '@/lib/documents';
import { formatTime } from '@/lib/format';
import type { Segment } from '@/lib/segments';
import { activityDataSchema } from '@/lib/segments';

import { LinkedDocumentChips } from './linked-document-chips';
import { subtitleWithPlusCodeBadge } from './plus-code-badge';
import { SegmentCardShell } from './segment-card-shell';

export function SegmentCardActivity({
  segment,
  linkedDocuments = [],
  coords,
}: {
  segment: Segment;
  linkedDocuments?: LinkedDocument[];
  /** Cached coordinates, if any — drive the Plus Code badge + deep link. */
  coords?: { lat: number; lng: number } | null;
}) {
  const parse = activityDataSchema.safeParse(segment.data);
  const title = parse.success ? parse.data.title : 'Activity';
  const description = parse.success ? parse.data.description : undefined;

  // ADR-0003: a NULL startsAt on an activity is the wishlist state. The
  // itinerary view filters those out, but this card variant is reused
  // on the Activities tab where both states surface together.
  const isWishlist = segment.startsAt === null;

  const meta = isWishlist ? (
    <Badge variant="default" size="sm">
      Wishlist
    </Badge>
  ) : segment.startsAt ? (
    <div className="text-foreground/75 font-mono text-[11px] leading-tight tracking-wider">
      <div>{formatTime(segment.startsAt)}</div>
      {segment.endsAt && (
        <div className="text-foreground/45 mt-0.5">→ {formatTime(segment.endsAt)}</div>
      )}
    </div>
  ) : null;

  const subtitle = subtitleWithPlusCodeBadge({
    parts: [segment.locationName, description],
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
