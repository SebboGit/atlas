import { BedDouble } from 'lucide-react';

import type { LinkedDocument } from '@/lib/documents';
import type { Segment } from '@/lib/segments';
import { hotelDataSchema } from '@/lib/segments';

import { LinkedDocumentChips } from './linked-document-chips';
import { LocalTime } from './local-time';
import { subtitleWithPlusCodeBadge } from './plus-code-badge';
import { SegmentCardShell } from './segment-card-shell';

function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

// Exact UTC-midnight means "date-only" — a hotel date-only check-in is a
// `YYYY-MM-DD` string the form parses to 00:00Z (no airport tz on hotels).
// Hide the time meta in that case; the card already shows the check-in
// date in the day-group header. Read in UTC (not local getters) so the
// "is this midnight?" decision is the same on the server and the client —
// otherwise an off-UTC viewer flips it and hydration mismatches.
function hasTimeComponent(d: Date | null): boolean {
  if (!d) return false;
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
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

  const meta = hasTimeComponent(segment.startsAt) ? (
    <div className="text-foreground/75 font-mono text-sm leading-tight tracking-wider">
      <div className="text-foreground/45 text-[10px] tracking-[0.2em] uppercase">Check-in</div>
      <div className="mt-1">
        <LocalTime date={segment.startsAt!} />
      </div>
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
