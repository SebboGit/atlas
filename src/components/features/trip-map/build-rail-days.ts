import type { ClassifiedDay } from '@/components/features/segments/day-temporal';
import { dayKey } from '@/components/features/segments/group-by-day';
import type { Segment } from '@/lib/segments';
import {
  activityDataSchema,
  flightDataSchema,
  foodDataSchema,
  hotelDataSchema,
  noteDataSchema,
  transitDataSchema,
} from '@/lib/segments/validators';

import type { MapGeometryIndex, RailDay, RailItem, RailItemIcon } from './timeline-model';

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
// A segment whose `startsAt` lands exactly on local midnight carries no
// meaningful clock time (it's a date-only pick — a hotel check-in, an
// all-day activity), so we suppress the label rather than print a
// misleading "00:00". UTC-midnight check too: fixture/extracted dates
// are commonly stored at UTC midnight, which is also "no time set".
function timeLabelFor(seg: Segment): string | null {
  const d = seg.startsAt;
  if (!d) return null;
  const isLocalMidnight =
    d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
  const isUtcMidnight =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  if (isLocalMidnight || isUtcMidnight) return null;
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
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
      timeLabel,
      country: pin.country,
      mapKind: 'pin',
    };
  }

  return {
    segmentId: seg.id,
    icon,
    label,
    timeLabel,
    country: seg.countryCode,
    mapKind: 'none',
    offMapReason: 'Not pinned on the map.',
  };
}

// Joins the server-classified days to the trip's map geometry, yielding
// the serialisable rail-day structure. Order is preserved — days are
// already chronological, and each day's segments keep their
// chronological-then-creation order from the repo query.
export function buildRailDays(days: ClassifiedDay[], geometry: MapGeometryIndex): RailDay[] {
  return days.map((day) => ({
    key: dayKey(day.date),
    dateKey: dayKey(day.date),
    dayNumber: day.dayNumber,
    position: day.position,
    items: day.segments.map((seg) => buildRailItem(seg, geometry)),
    // Date spans (item order) so the client-side collapsed-past split
    // can apply the ongoing-segment rule. Only the two date fields are
    // carried — the rail rows themselves stay date-free.
    spans: day.segments.map((seg) => ({ startsAt: seg.startsAt, endsAt: seg.endsAt })),
  }));
}
