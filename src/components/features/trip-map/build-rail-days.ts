import type { DayBucket } from '@/components/features/segments/group-by-day';
import { formatTime } from '@/lib/format';
import type { Segment } from '@/lib/segments';
import {
  activityDataSchema,
  flightDataSchema,
  foodDataSchema,
  hotelDataSchema,
  noteDataSchema,
  transitDataSchema,
} from '@/lib/segments/validators';

import type {
  MapGeometryIndex,
  RailContinuationCandidate,
  RailDay,
  RailItem,
  RailItemIcon,
} from './timeline-model';

// Builds the serialisable rail-day structure the chronological map's
// rail and sheet render. Pure given its inputs — the page passes
// already-classified days and the pin/arc geometry index, and this
// joins each segment to its map presence by `segmentId`.
//
// Why here and not in the trip-map repo: the repo already shapes pins
// and arcs (its concern is "what goes on the map"); this is the rail's
// concern ("what the timeline shows, and how each row maps"). Keeping
// it as a pure UI-shaping module — fed the repo's output — means it
// unit-tests without a DB and the repo stays focused.

// Map a raw segment type to the rail's icon glyph. `note` is included
// here (the rail shows notes even though they never hit the map);
// every other type lines up 1:1 with `TripMapPinKind`.
function iconForType(type: Segment['type']): RailItemIcon {
  return type;
}

// Headline label for a rail row. Mirrors the map-pin labellers in the
// trip-map repo (venue / property / title headline first) so a segment
// reads by the same name in the rail and on the map. Flights show the
// origin→dest IATA pair, which is the rail's most useful flight
// identity; notes show a trimmed preview of their body.
function labelForSegment(seg: Segment): string {
  switch (seg.type) {
    case 'flight': {
      const parsed = flightDataSchema.safeParse(seg.data);
      if (parsed.success) {
        const { originAirport, destinationAirport, carrier, flightNumber } = parsed.data;
        if (originAirport && destinationAirport) return `${originAirport} → ${destinationAirport}`;
        if (destinationAirport) return destinationAirport;
        const flightNo = [carrier, flightNumber].filter(Boolean).join(' ').trim();
        if (flightNo) return flightNo;
      }
      return seg.locationName ?? 'Flight';
    }
    case 'hotel': {
      const parsed = hotelDataSchema.safeParse(seg.data);
      if (parsed.success) return parsed.data.propertyName;
      return seg.locationName ?? 'Hotel';
    }
    case 'activity': {
      const parsed = activityDataSchema.safeParse(seg.data);
      if (parsed.success) return parsed.data.title;
      return seg.locationName ?? 'Activity';
    }
    case 'transit': {
      const parsed = transitDataSchema.safeParse(seg.data);
      if (parsed.success) {
        const { fromName, toName } = parsed.data;
        if (fromName && toName) return `${fromName} → ${toName}`;
        if (fromName ?? toName) return (fromName ?? toName) as string;
      }
      return seg.locationName ?? 'Transit';
    }
    case 'food': {
      const parsed = foodDataSchema.safeParse(seg.data);
      if (parsed.success) return parsed.data.venue;
      return seg.locationName ?? 'Food';
    }
    case 'note': {
      const parsed = noteDataSchema.safeParse(seg.data);
      if (parsed.success) {
        const body = parsed.data.body.trim();
        return body.length > 80 ? `${body.slice(0, 79)}…` : body;
      }
      return 'Note';
    }
  }
}

// Wall-clock time-of-day for a row, or null for a date-only segment.
// Non-flight times are floating-UTC wall-clocks (ADR-0014): a date-only
// pick lands on UTC midnight and carries no meaningful clock time, so we
// suppress the label rather than print a misleading "00:00". Read the
// "is this midnight?" decision in UTC so it matches the cards' suppress
// gate and stays deterministic on any server timezone.
function timeLabelFor(seg: Segment): string | null {
  const d = seg.startsAt;
  if (!d) return null;
  const isUtcMidnight =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  if (isUtcMidnight) return null;
  // Render in UTC so the rail's time column agrees with the segment
  // cards, which all render their floating-UTC times in UTC. Flights
  // (airport-tz on the card) appear here in UTC too — the rail is a
  // compact secondary surface, kept deterministic over per-end tz.
  return formatTime(d, { timeZone: 'UTC' });
}

// Builds a single rail item, resolving its map presence by segmentId
// against the geometry index. Flights map to their arc (the per-leg
// geometry); hotel / activity / transit / food map to their pin when
// the geocode cache resolved it; notes — and any segment with no pin
// or arc — are off-map with a quiet reason.
function buildRailItem(seg: Segment, geometry: MapGeometryIndex): RailItem {
  const icon = iconForType(seg.type);
  const label = labelForSegment(seg);
  const timeLabel = timeLabelFor(seg);

  if (seg.type === 'note') {
    return {
      segmentId: seg.id,
      icon,
      label,
      locationName: seg.locationName,
      timeLabel,
      country: seg.countryCode,
      mapKind: 'none',
      offMapReason: 'Note — not on the map.',
    };
  }

  if (seg.type === 'flight') {
    const arc = geometry.arcBySegmentId.get(seg.id);
    if (arc) {
      return {
        segmentId: seg.id,
        icon,
        label,
        locationName: seg.locationName,
        timeLabel,
        // The arc's destination is the flight's primary country
        // (ADR-0005); chip dimming treats the leg by where it lands.
        country: arc.destCountry ?? seg.countryCode,
        mapKind: 'arc',
      };
    }
    // A flight pin with no arc still places a single airport marker —
    // fall through to the pin branch below.
  }

  const pin = geometry.pinBySegmentId.get(seg.id);
  if (pin) {
    return {
      segmentId: seg.id,
      icon,
      label,
      locationName: seg.locationName,
      timeLabel,
      country: pin.country,
      mapKind: 'pin',
    };
  }

  return {
    segmentId: seg.id,
    icon,
    label,
    locationName: seg.locationName,
    timeLabel,
    country: seg.countryCode,
    mapKind: 'none',
    offMapReason: 'Not pinned on the map.',
  };
}

// Check-in date label for a continuation row ("28 May"). Read in UTC so
// it matches the floating-UTC day the segment is grouped under — the
// continuation should name the same date as its collapsed check-in card.
const SINCE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
function formatSince(d: Date): string {
  return SINCE_FMT.format(d);
}

// A multi-day stay surfaced on a day AFTER its check-in. Reuses the
// segment's normal label / icon / map presence (so tapping focuses the
// same pin), but carries no time-of-day and is flagged `continuation`
// with the check-in date for the rail's quiet "staying" treatment. The
// row is identical whichever later day it lands on, so it's built ONCE
// here (on the segment's own check-in day); the client re-uses it on
// every day the stay spans and stamps the check-out time on the final
// day (see `resolveRailDays`).
function buildContinuationItem(seg: Segment, geometry: MapGeometryIndex): RailItem {
  return {
    ...buildRailItem(seg, geometry),
    timeLabel: null,
    continuation: true,
    continuationSince: seg.startsAt ? formatSince(seg.startsAt) : null,
  };
}

// A hotel's display-only check-out time ("11:00"), or null for a
// non-hotel or a hotel with none entered. Carried on the continuation
// candidate so `resolveRailDays` can stamp it on the stay's final day.
function hotelCheckOutTime(seg: Segment): string | null {
  if (seg.type !== 'hotel') return null;
  const parsed = hotelDataSchema.safeParse(seg.data);
  return parsed.success ? (parsed.data.checkOutTime ?? null) : null;
}

// The span-capable segments checking in ON this day — those with BOTH
// endpoints, the only ones that can ever continue onto a later day (a
// single-day or open-ended segment never does, matching
// `continuesThroughDay`'s guard). Each carries its pre-built
// continuation row plus the raw endpoints the client tests against each
// visible day. The clock plays no part here — WHICH later days a stay
// actually surfaces on is decided client-side, in the viewer's timezone.
function buildContinuationCandidates(
  segments: Segment[],
  geometry: MapGeometryIndex,
): RailContinuationCandidate[] {
  const out: RailContinuationCandidate[] = [];
  for (const seg of segments) {
    if (!seg.startsAt || !seg.endsAt) continue;
    out.push({
      item: buildContinuationItem(seg, geometry),
      startsAt: seg.startsAt,
      endsAt: seg.endsAt,
      checkOutTime: hotelCheckOutTime(seg),
    });
  }
  return out;
}

// Joins each day-bucket to the trip's map geometry, yielding the
// serialisable rail-day structure. NO clock here: past / today / future
// classification and the continuation-row placement both happen
// client-side, in the viewer's timezone (`resolveRailDays`), so the rail
// and the itinerary tab agree on "today" (ADR-0016). Each day therefore
// carries its OWN segment rows plus the span-capable check-ins
// (`continuationCandidates`) the client may later surface on the days
// they span.
//
// Order is preserved — buckets are already chronological, and each day's
// segments keep their chronological-then-creation order from the repo
// query. `dayNumber` is the 1-based chronological index, independent of
// any temporal position (it never renumbers as days collapse).
export function buildRailDays(days: DayBucket[], geometry: MapGeometryIndex): RailDay[] {
  return days.map((day, i) => ({
    key: day.key,
    dateKey: day.key,
    dayNumber: i + 1,
    items: day.segments.map((seg) => buildRailItem(seg, geometry)),
    continuationCandidates: buildContinuationCandidates(day.segments, geometry),
  }));
}
