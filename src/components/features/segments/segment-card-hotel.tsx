import { BedDouble } from 'lucide-react';

import type { LinkedDocument } from '@/lib/documents';
import type { Segment } from '@/lib/segments';
import { hotelDataSchema } from '@/lib/segments';

import { LinkedDocumentChips } from './linked-document-chips';
import { subtitleWithPlusCodeBadge } from './plus-code-badge';
import { SegmentCardShell } from './segment-card-shell';

function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

export function SegmentCardHotel({
  segment,
  linkedDocuments = [],
  coords,
}: {
  segment: Segment;
  linkedDocuments?: LinkedDocument[];
  /** Cached coordinates, if any — drive the Plus Code badge + deep link. */
  coords?: { lat: number; lng: number } | null;
}) {
  const parse = hotelDataSchema.safeParse(segment.data);
  const propertyName = parse.success ? parse.data.propertyName : 'Hotel';
  const roomType = parse.success ? parse.data.roomType : undefined;
  // Check-in time is display-only `data` metadata (the form's own field),
  // not derived from `startsAt` — `startsAt` stays a date-only day anchor
  // so the hotel orders by check-in DATE alone. Check-out time is shown on
  // the last-day "Staying" continuation, not here on the check-in card.
  const checkInTime = parse.success ? parse.data.checkInTime : undefined;

  const nights =
    segment.startsAt && segment.endsAt ? nightsBetween(segment.startsAt, segment.endsAt) : null;

  const subtitle = subtitleWithPlusCodeBadge({
    parts: [
      segment.locationName,
      nights !== null ? `${nights} night${nights === 1 ? '' : 's'}` : null,
      roomType,
    ],
    coords,
    venue: propertyName,
  });

  const meta = checkInTime ? (
    <div className="text-foreground/75 font-mono text-sm leading-tight tracking-wider">
      <div className="text-foreground/45 text-[10px] tracking-[0.2em] uppercase">Check-in</div>
      <div className="mt-1">{checkInTime}</div>
    </div>
  ) : null;

  return (
    <SegmentCardShell
      type="hotel"
      glyph={<BedDouble className="size-4" strokeWidth={1.5} />}
      typeLabel="Hotel"
      title={propertyName}
      subtitle={subtitle}
      meta={meta}
      footer={
        linkedDocuments.length > 0 ? <LinkedDocumentChips documents={linkedDocuments} /> : undefined
      }
      needsReview={segment.needsReview}
    />
  );
}
