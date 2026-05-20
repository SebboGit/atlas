import { Sparkles } from 'lucide-react';

import type { LinkedDocument } from '@/lib/documents';
import { formatTime } from '@/lib/format';
import type { Segment } from '@/lib/segments';
import { activityDataSchema } from '@/lib/segments';

import { LinkedDocumentChips } from './linked-document-chips';
import { SegmentCardShell } from './segment-card-shell';

export function SegmentCardActivity({
  segment,
  linkedDocuments = [],
}: {
  segment: Segment;
  linkedDocuments?: LinkedDocument[];
}) {
  const parse = activityDataSchema.safeParse(segment.data);
  const title = parse.success ? parse.data.title : 'Activity';
  const description = parse.success ? parse.data.description : undefined;

  // ADR-0003: a NULL startsAt on an activity is the wishlist state. The
  // itinerary view filters those out, but this card variant is reused
  // on the Activities tab where both states surface together.
  const isWishlist = segment.startsAt === null;

  const meta = isWishlist ? (
    <span className="border-foreground/25 text-foreground/55 inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-[0.24em] uppercase">
      Wishlist
    </span>
  ) : segment.startsAt ? (
    <div className="text-foreground/75 font-mono text-[11px] leading-tight tracking-wider">
      <div>{formatTime(segment.startsAt)}</div>
      {segment.endsAt && (
        <div className="text-foreground/45 mt-0.5">→ {formatTime(segment.endsAt)}</div>
      )}
    </div>
  ) : null;

  const subtitleParts = [segment.locationName, description].filter(Boolean);

  return (
    <SegmentCardShell
      glyph={<Sparkles className="size-4" strokeWidth={1.5} />}
      typeLabel="Activity"
      title={title}
      subtitle={subtitleParts.length ? subtitleParts.join(' · ') : undefined}
      meta={meta}
      footer={
        linkedDocuments.length > 0 ? <LinkedDocumentChips documents={linkedDocuments} /> : undefined
      }
      needsReview={segment.needsReview}
    />
  );
}
