import { UtensilsCrossed } from 'lucide-react';

import type { LinkedDocument } from '@/lib/documents';
import { formatTime } from '@/lib/format';
import type { Segment } from '@/lib/segments';
import { foodDataSchema } from '@/lib/segments';

import { LinkedDocumentChips } from './linked-document-chips';
import { SegmentCardShell } from './segment-card-shell';

// The food card subtitle locates the venue. The parsed address wins
// when present; otherwise we fall back to the free-text location
// label. The booking reference is reservation bookkeeping, not a
// place — it never appears here, only in the info dialog. Empty
// strings collapse to undefined so the card shows no subtitle rather
// than an empty line.
export function foodCardSubtitle({
  address,
  locationName,
}: {
  address?: string | null;
  locationName?: string | null;
}): string | undefined {
  return address || locationName || undefined;
}

export function SegmentCardFood({
  segment,
  linkedDocuments = [],
}: {
  segment: Segment;
  linkedDocuments?: LinkedDocument[];
}) {
  const parse = foodDataSchema.safeParse(segment.data);
  const title = parse.success ? parse.data.venue : 'Meal';
  const address = parse.success ? parse.data.address : undefined;

  // Food can be left undated — an in-trip shortlist of "maybe"
  // places to eat. When a reservation time is set we surface it;
  // an undated meal shows no meta.
  const meta = segment.startsAt ? (
    <div className="text-foreground/75 font-mono text-[11px] leading-tight tracking-wider">
      <div>{formatTime(segment.startsAt)}</div>
      {segment.endsAt && (
        <div className="text-foreground/45 mt-0.5">→ {formatTime(segment.endsAt)}</div>
      )}
    </div>
  ) : null;

  const subtitle = foodCardSubtitle({ address, locationName: segment.locationName });

  return (
    <SegmentCardShell
      glyph={<UtensilsCrossed className="size-4" strokeWidth={1.5} />}
      typeLabel="Food"
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
