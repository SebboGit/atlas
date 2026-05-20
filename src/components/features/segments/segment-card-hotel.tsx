import { BedDouble } from 'lucide-react';

import type { LinkedDocument } from '@/lib/documents';
import { formatTime } from '@/lib/format';
import type { Segment } from '@/lib/segments';
import { hotelDataSchema } from '@/lib/segments';

import { LinkedDocumentChips } from './linked-document-chips';
import { SegmentCardShell } from './segment-card-shell';

function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

// Exact local-midnight means "date-only" (form date picker, extraction
// mapper). Hide the time meta in that case — the card already shows
// the check-in date in the day-group header. Same trade-off as
// segment-card-flight.
function hasTimeComponent(d: Date | null): boolean {
  if (!d) return false;
  return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
}

export function SegmentCardHotel({
  segment,
  linkedDocuments = [],
}: {
  segment: Segment;
  linkedDocuments?: LinkedDocument[];
}) {
  const parse = hotelDataSchema.safeParse(segment.data);
  const propertyName = parse.success ? parse.data.propertyName : 'Hotel';
  const roomType = parse.success ? parse.data.roomType : undefined;

  const nights =
    segment.startsAt && segment.endsAt ? nightsBetween(segment.startsAt, segment.endsAt) : null;

  const subtitleParts = [
    segment.locationName,
    nights !== null ? `${nights} night${nights === 1 ? '' : 's'}` : null,
    roomType,
  ].filter(Boolean);

  const meta = hasTimeComponent(segment.startsAt) ? (
    <div className="text-foreground/75 font-mono text-sm leading-tight tracking-wider">
      <div className="text-foreground/45 text-[10px] tracking-[0.2em] uppercase">Check-in</div>
      <div className="mt-1">{formatTime(segment.startsAt!)}</div>
    </div>
  ) : null;

  return (
    <SegmentCardShell
      glyph={<BedDouble className="size-4" strokeWidth={1.5} />}
      typeLabel="Hotel"
      title={propertyName}
      subtitle={subtitleParts.length ? subtitleParts.join(' · ') : undefined}
      meta={meta}
      footer={
        linkedDocuments.length > 0 ? <LinkedDocumentChips documents={linkedDocuments} /> : undefined
      }
      needsReview={segment.needsReview}
    />
  );
}
