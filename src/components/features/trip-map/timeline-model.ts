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
   * The segment's real `locationName` (a place — "Shibuya", "Paris"), or
   * null. Distinct from `label`: for flights/transit/notes the label is
   * an IATA pair / "A → B" / body preview, none of which is a place, so
   * the collapsed-past pill summarises off this field instead (matching
   * the itinerary tab).
   */
  locationName: string | null;
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
  /**
   * True when this row is a multi-day stay surfaced on a day AFTER its
   * check-in (its primary card lives on the collapsed check-in day). The
   * rail renders it quietly — a "staying" backdrop to the day, not a
   * fresh event. Still mapKind-driven so tapping it focuses the same pin.
   */
  continuation?: boolean;
  /** Check-in date label for a continuation row (e.g. "28 May"). */
  continuationSince?: string | null;
}

export interface RailDay {
  /** Stable per-day key — `YYYY-MM-DD`, matches `groupSegmentsByDay`. */
  key: string;
  /** Timezone-stable `YYYY-MM-DD` token, parsed client-side for labels. */
  dateKey: string;
  dayNumber: number;
  position: DayPosition;
  items: RailItem[];
}

// Index of a trip's pins and arcs by segment id, so the rail-builder
// can look up geometry without re-scanning the arrays. Flight pins
// dedupe by airport and key to the first leg's segmentId, so a flight
// segment may have an arc entry but no pin entry under its own id — the
// builder handles both.
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

// The set of segment ids the map should highlight for a focused or
// hovered day — every mappable item in the day. Items the map can't
// place (`none`) are excluded so they never carry a phantom highlight.
export function mappableSegmentIds(day: RailDay): string[] {
  return day.items.filter((i) => i.mapKind !== 'none').map((i) => i.segmentId);
}

// Whether a pin renders dimmed. Two orthogonal dim sources compose
// (issue #9): the country chip strip (spatial) and the timeline day
// highlight (temporal). A pin shows at full opacity only when it passes
// BOTH — it's in the active country (or no country is active) AND it's
// in the highlighted-day set (or no day highlight is active). Either
// filter failing dims it. Pure + exported so the composition the map
// hinges on is unit-tested without a live MapLibre instance.
export function isPinDimmed(
  pin: TripMapPin,
  activeCountry: string | null,
  highlightIds: ReadonlySet<string> | null,
): boolean {
  if (activeCountry !== null && pin.country !== activeCountry) return true;
  if (highlightIds !== null && !highlightIds.has(pin.segmentId)) return true;
  return false;
}

// Same composition for arcs. An arc dims unless BOTH endpoints sit in
// the active country (a half-in arc reads as out of focus) AND — when a
// day highlight is active — its segment is in the highlighted set.
export function isArcDimmed(
  arc: TripMapArc,
  activeCountry: string | null,
  highlightIds: ReadonlySet<string> | null,
): boolean {
  if (
    activeCountry !== null &&
    (arc.originCountry !== activeCountry || arc.destCountry !== activeCountry)
  ) {
    return true;
  }
  if (highlightIds !== null && !highlightIds.has(arc.segmentId)) return true;
  return false;
}
