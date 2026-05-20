import { Bus, Car, Ship, TrainFront, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { LinkedDocument } from '@/lib/documents';
import { formatTime } from '@/lib/format';
import type { Segment, TransitData } from '@/lib/segments';
import { transitDataSchema } from '@/lib/segments';

import { LinkedDocumentChips } from './linked-document-chips';
import { SegmentCardShell } from './segment-card-shell';

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
}: {
  segment: Segment;
  linkedDocuments?: LinkedDocument[];
}) {
  const parse = transitDataSchema.safeParse(segment.data);
  const mode = parse.success ? parse.data.mode : 'other';
  const data = parse.success ? parse.data : { mode: 'other' as const };

  const Icon = MODE_ICON[mode];
  const label = MODE_LABEL[mode];

  const titleParts = [data.fromName, data.toName].filter(Boolean);
  const title =
    titleParts.length === 2 ? `${titleParts[0]} → ${titleParts[1]}` : (titleParts[0] ?? label);

  const subtitleParts = [data.carrier, data.referenceNumber].filter(Boolean);

  const meta = segment.startsAt ? (
    <div className="text-foreground/75 font-mono text-[11px] leading-tight tracking-wider">
      <div>{formatTime(segment.startsAt)}</div>
      {segment.endsAt && (
        <div className="text-foreground/45 mt-0.5">→ {formatTime(segment.endsAt)}</div>
      )}
    </div>
  ) : null;

  return (
    <SegmentCardShell
      glyph={<Icon className="size-4" strokeWidth={1.5} />}
      typeLabel={label}
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
