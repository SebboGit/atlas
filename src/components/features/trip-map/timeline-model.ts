import type { DayPosition } from '@/components/features/segments/day-temporal';
import type { TripMapArc, TripMapPin } from '@/lib/trip-map/repo';

// Serialisable shapes that cross the RSC → client boundary for the
// chronological trip map. The server page builds these from the full
// segment list joined to the map's pins and arcs; the client rail and
// sheet render them and drive the map off the same `segmentId`s.
//
// Everything here is plain JSON — no Date, Map, or Set — so Next can
// pass it across the wire. `dateKey` carries the timezone-stable day
// token; resolved coordinates are inlined so the client knows, without
// a second lookup, which items are mappable and where they sit.

// What a single rail row represents on the map. Drives the focus /
// fit behaviour: a `flight` item focuses on its arc endpoints (flight
// pins are deduped + keyed to the first leg's segmentId, so the arc is
// the reliable per-segment geometry), every other mappable kind
// focuses on its single pin, and `none` items (notes, ungeocoded
// segments) render in the rail but never touch the map.
export type RailItemMapKind = 'pin' | 'arc' | 'none';

// Icon glyph for the rail row. Mirrors `TripMapPinKind` plus `note`
// (notes appear in the rail but never on the map). Resolved on the
// server so the client doesn't re-derive it from the raw segment type.
export type RailItemIcon = 'flight' | 'hotel' | 'activity' | 'transit' | 'food' | 'note';

export interface RailItem {
  /** Segment id — the join key the rail uses to drive the map. */
  segmentId: string;
  icon: RailItemIcon;
  /** Headline label (venue / title / IATA pair / note preview). */
  label: string;
  /**
   * Wall-clock time-of-day for the row ("09:12"), or null for a
   * date-only segment (a hotel check-in stored at local midnight has
   * no meaningful clock time to show).
   */
  timeLabel: string | null;
  /** ISO 3166-1 alpha-2 the row's pin/arc belongs to; null when none. */
  country: string | null;
  mapKind: RailItemMapKind;
  /**
   * One-line reason a `none` item isn't on the map (e.g. "Note" or a
   * geocode miss). Surfaced quietly under the row. Absent for mappable
   * rows.
   */
  offMapReason?: string;
}

export interface RailDay {
  /** Stable per-day key — `YYYY-MM-DD`, matches `groupSegmentsByDay`. */
  key: string;
  /** Timezone-stable `YYYY-MM-DD` token, parsed client-side for labels. */
  dateKey: string;
  dayNumber: number;
  position: DayPosition;
  items: RailItem[];
  /**
   * Per-segment date spans for this day, in item order. Drives the
   * client-side collapsed-past split: `splitCollapsedDays` reads
   * `startsAt` / `endsAt` to break the collapsed run at the first day
   * holding a segment still ongoing as of *today* (the multi-day-hotel
   * rule — see day-temporal.ts). Carried separately from `items` so a
   * rail row stays a light display shape; Next serialises the Date
   * values across the RSC boundary (same as `TripMapPin.date`).
   */
  spans: Array<{ startsAt: Date | null; endsAt: Date | null }>;
}

// A geographic point the map can fit to or pan to.
export interface MapPoint {
  lat: number;
  lng: number;
}

// Index of a trip's pins and arcs by segment id, so the rail-builder
// (and the client focus/fit resolvers) can look up geometry without
// re-scanning the arrays. Flight pins dedupe by airport and key to the
// first leg's segmentId, so a flight segment may have an arc entry but
// no pin entry under its own id — the resolvers handle both.
export interface MapGeometryIndex {
  pinBySegmentId: Map<string, TripMapPin>;
  arcBySegmentId: Map<string, TripMapArc>;
}

export function indexMapGeometry(pins: TripMapPin[], arcs: TripMapArc[]): MapGeometryIndex {
  const pinBySegmentId = new Map<string, TripMapPin>();
  for (const pin of pins) {
    // First write wins — a flight segment can produce two airport pins
    // (origin + dest) that share the same segmentId; the rail only
    // needs one representative, and flights focus via their arc anyway.
    if (!pinBySegmentId.has(pin.segmentId)) pinBySegmentId.set(pin.segmentId, pin);
  }
  const arcBySegmentId = new Map<string, TripMapArc>();
  for (const arc of arcs) {
    if (!arcBySegmentId.has(arc.segmentId)) arcBySegmentId.set(arc.segmentId, arc);
  }
  return { pinBySegmentId, arcBySegmentId };
}

// Resolves the geographic point(s) a single rail item focuses / fits
// to. A `pin` item yields its one coordinate; an `arc` item yields
// both endpoints (so a flight frames its whole leg, not just one end);
// a `none` item yields nothing. Pure — the same function backs both
// the per-item pan and the per-day fitBounds.
export function pointsForItem(item: RailItem, geometry: MapGeometryIndex): MapPoint[] {
  if (item.mapKind === 'arc') {
    const arc = geometry.arcBySegmentId.get(item.segmentId);
    if (!arc) return [];
    return [
      { lat: arc.originLat, lng: arc.originLng },
      { lat: arc.destLat, lng: arc.destLng },
    ];
  }
  if (item.mapKind === 'pin') {
    const pin = geometry.pinBySegmentId.get(item.segmentId);
    if (!pin) return [];
    return [{ lat: pin.lat, lng: pin.lng }];
  }
  return [];
}

// The single point the map pans to when a specific item is clicked.
// For an arc, that's the destination endpoint (where the leg lands —
// the place you're arriving at, which reads as "this flight's
// location"); for a pin, the pin itself. Null when the item isn't
// mappable.
export function focusPointForItem(item: RailItem, geometry: MapGeometryIndex): MapPoint | null {
  if (item.mapKind === 'arc') {
    const arc = geometry.arcBySegmentId.get(item.segmentId);
    return arc ? { lat: arc.destLat, lng: arc.destLng } : null;
  }
  if (item.mapKind === 'pin') {
    const pin = geometry.pinBySegmentId.get(item.segmentId);
    return pin ? { lat: pin.lat, lng: pin.lng } : null;
  }
  return null;
}

// The set of segment ids the map should highlight for a focused or
// hovered day — every mappable item in the day. Items the map can't
// place (`none`) are excluded so they never carry a phantom highlight.
export function mappableSegmentIds(day: RailDay): string[] {
  return day.items.filter((i) => i.mapKind !== 'none').map((i) => i.segmentId);
}

// All geographic points for a day — used to fitBounds the map onto a
// focused day. Flattens every mappable item's point(s). Empty when the
// day holds nothing mappable (the caller then leaves the frame alone).
export function pointsForDay(day: RailDay, geometry: MapGeometryIndex): MapPoint[] {
  return day.items.flatMap((item) => pointsForItem(item, geometry));
}

// Finds the day owning a given segment id — used to resolve which day a
// map-tap selects (so a pin click reflects back into the rail / sheet).
// Returns null for an id not present in any day (e.g. a wishlist-overlay
// pin, which has no rail row).
export function dayKeyForSegment(days: RailDay[], segmentId: string): string | null {
  for (const day of days) {
    if (day.items.some((i) => i.segmentId === segmentId)) return day.key;
  }
  return null;
}
