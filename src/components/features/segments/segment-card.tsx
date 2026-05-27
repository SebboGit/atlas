import type { LinkedDocument } from '@/lib/documents';
import type { Segment } from '@/lib/segments';

import { SegmentCardActivity } from './segment-card-activity';
import { SegmentCardFlight } from './segment-card-flight';
import { SegmentCardFood } from './segment-card-food';
import { SegmentCardHotel } from './segment-card-hotel';
import { SegmentCardNote } from './segment-card-note';
import { SegmentCardTransit } from './segment-card-transit';

// Dispatcher — picks the right card variant for a segment's type. The
// segment.type column is a Postgres enum and the variants exhaust it,
// so the switch is total.
//
// `linkedDocuments` is the per-segment slice of the trip-wide map
// fetched by the page; an empty/undefined array suppresses the chip
// footer. Notes don't render the chips today — the extraction
// pipeline never auto-links a doc to a note, and notes use a custom
// shell layout (no `footer` slot to drop chips into).
export function SegmentCard({
  segment,
  linkedDocuments = [],
  coords,
}: {
  segment: Segment;
  linkedDocuments?: LinkedDocument[];
  /**
   * Cached coordinates for the Plus Code badge. Flights resolve coords
   * via the IATA snapshot (handled inside the flight card itself); the
   * non-flight variants take this through.
   */
  coords?: { lat: number; lng: number } | null;
}) {
  switch (segment.type) {
    case 'flight':
      return <SegmentCardFlight segment={segment} linkedDocuments={linkedDocuments} />;
    case 'hotel':
      return (
        <SegmentCardHotel segment={segment} linkedDocuments={linkedDocuments} coords={coords} />
      );
    case 'activity':
      return (
        <SegmentCardActivity segment={segment} linkedDocuments={linkedDocuments} coords={coords} />
      );
    case 'transit':
      return (
        <SegmentCardTransit segment={segment} linkedDocuments={linkedDocuments} coords={coords} />
      );
    case 'food':
      return (
        <SegmentCardFood segment={segment} linkedDocuments={linkedDocuments} coords={coords} />
      );
    case 'note':
      return <SegmentCardNote segment={segment} />;
  }
}
