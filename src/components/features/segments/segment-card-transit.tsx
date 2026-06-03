import { Bus, Car, Ship, TrainFront, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { LinkedDocument } from '@/lib/documents';
import type { Segment, TransitData } from '@/lib/segments';
import { transitDataSchema } from '@/lib/segments';

import { LinkedDocumentChips } from './linked-document-chips';
import { subtitleWithPlusCodeBadge } from './plus-code-badge';
import { SegmentCardShell } from './segment-card-shell';
import { SegmentTimeMeta } from './segment-time-meta';

const MODE_ICON: Record<TransitData['mode'], LucideIcon> = {
  train: TrainFront,
  bus: Bus,
  ferry: Ship,
  car: Car,
  other: Waypoints,
};

const MODE_LABEL: Record<TransitData['mode'], string> = {
  train: 'Train',
  bus: 'Bus',
  ferry: 'Ferry',
  car: 'Car',
  other: 'Transit',
};

export function SegmentCardTransit({
  segment,
  linkedDocuments = [],
  coords,
}: {
  segment: Segment;
  linkedDocuments?: LinkedDocument[];
  /** Cached coordinates, if any — drive the Plus Code badge + deep link. */
  coords?: { lat: number; lng: number } | null;
}) {
  const parse = transitDataSchema.safeParse(segment.data);
  const mode = parse.success ? parse.data.mode : 'other';
  const data = parse.success ? parse.data : { mode: 'other' as const };

  const Icon = MODE_ICON[mode];
  const label = MODE_LABEL[mode];

  const titleParts = [data.fromName, data.toName].filter(Boolean);
  const title =
    titleParts.length === 2 ? `${titleParts[0]} → ${titleParts[1]}` : (titleParts[0] ?? label);

  const meta = <SegmentTimeMeta startsAt={segment.startsAt} endsAt={segment.endsAt} />;

  const subtitle = subtitleWithPlusCodeBadge({
    parts: [data.carrier, data.referenceNumber],
    coords,
    // Destination is the venue Maps should land on when the user
    // taps the badge — origin is the boarding point, not the place.
    venue: data.toName ?? data.fromName ?? null,
  });

  return (
    <SegmentCardShell
      type="transit"
      glyph={<Icon className="size-4" strokeWidth={1.5} />}
      typeLabel={label}
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
