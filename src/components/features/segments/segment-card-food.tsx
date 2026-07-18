import { UtensilsCrossed } from 'lucide-react';

import type { LinkedDocument } from '@/lib/documents';
import type { Segment } from '@/lib/segments';
import { foodDataSchema } from '@/lib/segments';

import { LinkedDocumentChips } from './linked-document-chips';
import { segmentCity } from './segment-city';
import { subtitleWithPlusCodeBadge } from './plus-code-badge';
import { SegmentCardShell } from './segment-card-shell';
import { SegmentTimeMeta } from './segment-time-meta';

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
  coords,
  showDate = false,
}: {
  segment: Segment;
  linkedDocuments?: LinkedDocument[];
  /** Cached coordinates, if any — drive the Plus Code badge + deep link. */
  coords?: { lat: number; lng: number; city?: string | null } | null;
  /**
   * On the flat Food tab the card carries its own date (no day-group
   * header there); the itinerary leaves it off. See SegmentTimeMeta.
   */
  showDate?: boolean;
}) {
  const parse = foodDataSchema.safeParse(segment.data);
  const title = parse.success ? parse.data.venue : 'Meal';
  const address = parse.success ? parse.data.address : undefined;

  // Food can be left undated — an in-trip shortlist of "maybe" places to
  // eat. The date+time meta surfaces a reservation; an undated meal shows
  // none.
  const meta = (
    <SegmentTimeMeta startsAt={segment.startsAt} endsAt={segment.endsAt} showDate={showDate} />
  );

  const subtitleText = foodCardSubtitle({ address, locationName: segment.locationName });
  const subtitle = subtitleWithPlusCodeBadge({
    parts: [subtitleText, segmentCity(coords, subtitleText ?? segment.locationName)],
    coords,
    venue: title,
  });

  return (
    <SegmentCardShell
      type="food"
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
