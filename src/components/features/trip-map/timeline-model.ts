import {
  classifyDay,
  continuesThroughDay,
  splitCollapsedDays,
  startOfLocalDay,
  type DayPosition,
} from '@/components/features/segments/day-temporal';
import type { TripMapArc, TripMapPin } from '@/lib/trip-map/repo';

// Serialisable shapes that cross the RSC → client boundary for the
// chronological trip map. The server page builds these from the full
// segment list joined to the map's pins and arcs; the client rail and
// sheet render them and drive the map off the same `segmentId`s.
//
// JSON-ish across the wire: no Map or Set (the client rebuilds those),
// but plain `Date`s are fine — Next rehydrates them the same way the
// itinerary's `ItineraryDay.segments` already carry `Date` fields. The
// `dateKey` token carries the timezone-stable day
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
  /**
   * Check-out time ("11:00") for a continuation row — set ONLY on the
   * stay's final day, so the last "staying" row reads as the checkout.
   * Null on every earlier day and for stays with no check-out time.
   */
  continuationCheckOut?: string | null;
}

// A span-capable segment on this day that MIGHT continue onto a later
// day, carried so the client can recompute continuation rows in the
// viewer's timezone (mirroring the itinerary tab). The continuation
// RailItem is pre-built (geometry-joined, continuation-styled) so the
// client doesn't re-derive labels/icons/map presence; the bare
// `startsAt`/`endsAt` instants are what `continuesThroughDay` needs to
// decide, per visible day, whether this stay still spans it.
//
// Only emitted for segments with BOTH endpoints (a stay can span a
// range); single-day / open-ended segments never continue, so they
// never appear here. `startsAt`/`endsAt` are `Date`s — they round-trip
// across the RSC boundary the same way `ItineraryDay.segments` does.
export interface RailContinuationCandidate {
  /** The continuation row to render on each later day this stay spans. */
  item: RailItem;
  /** Check-in instant — the earlier-than-the-visible-day endpoint. */
  startsAt: Date;
  /** Check-out instant — the on-or-after-the-visible-day endpoint. */
  endsAt: Date;
  /**
   * Hotel check-out time ("11:00"), display-only — `resolveRailDays`
   * surfaces it on the stay's FINAL day only. Null for non-hotels and
   * hotels with no check-out time entered.
   */
  checkOutTime: string | null;
}

export interface RailDay {
  /** Stable per-day key — `YYYY-MM-DD`, matches `groupSegmentsByDay`. */
  key: string;
  /** Timezone-stable `YYYY-MM-DD` token, parsed client-side for labels. */
  dateKey: string;
  dayNumber: number;
  // NOTE: NO `position` here. Past / today / future is reclassified
  // client-side against the VIEWER's clock (mirroring the itinerary tab,
  // ADR-0016) so the rail and itinerary always agree on "today". A
  // baked server position would re-introduce the cross-tab disagreement
  // near midnight in a non-UTC timezone.
  /** This day's own segments, geometry-joined — clock-independent. */
  items: RailItem[];
  /**
   * Span-capable segments checking in ON this day that may continue onto
   * later days. Used by the client to recompute "Staying since"
   * continuation rows once it knows which days collapsed — a continuation
   * only surfaces on a visible day whose check-in day actually folded.
   */
  continuationCandidates: RailContinuationCandidate[];
}

// A `RailDay` after the client resolves it against the VIEWER's clock:
// the temporal `position` is now known, and `items` is the FINAL render
// list — any "Staying since" continuation rows have been prepended.
// `continuationCandidates` has done its job (folded into `items`) and is
// dropped. The rail, sheet, and the parent's map-highlight maths all
// consume this resolved shape.
export interface ResolvedRailDay {
  key: string;
  dateKey: string;
  dayNumber: number;
  /** Viewer-relative past / today / future (client-resolved). */
  position: DayPosition;
  /** Final render list: continuation rows first, then the day's own rows. */
  items: RailItem[];
}

// Local `YYYY-MM-DD` → local-midnight Date for the calendar-day maths
// `continuesThroughDay`/`classifyDay` need. Inlined (rather than reusing
// the date-picker's `parseDateString`) so this stays a pure module the
// server page can import without pulling in a `'use client'` graph —
// the same trade-off `continuations.ts` makes for the itinerary. The
// token is server-generated and structurally valid; a bad parse falls
// back to the epoch rather than crashing render.
function parseDateKey(dateKey: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return new Date(0);
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

// Resolves the server's clock-agnostic `RailDay[]` into the viewer's
// timezone. This is the rail's mirror of the itinerary's mount-time
// `useMemo` (ADR-0016): both surfaces now classify days against the
// SAME viewer `today`, so they can never disagree on which day is
// "Today", which days collapse, or which continuation rows show.
//
// `clientToday === null` is the pre-mount / SSR branch: every day is
// neutralised to `future` (nothing collapses, no Today pill, no
// continuations prepended) so the first paint never bakes a
// server-timezone guess and hydration matches byte-for-byte.
//
// Post-mount, each day's `position` is re-derived from its stable date
// token against the viewer's `today`, then `splitCollapsedDays` finds
// the leading collapsed run. A continuation surfaces on a visible
// (today/future) day iff its check-in day is in that COLLAPSED run AND
// the stay `continuesThroughDay` the visible day — identical gating to
// `ongoingContinuationsByDayKey`, recomputed here from the per-day
// candidates so the rows match whatever the viewer-relative split
// produced.
export function resolveRailDays(days: RailDay[], clientToday: Date | null): ResolvedRailDay[] {
  if (!clientToday) {
    return days.map((d) => ({
      key: d.key,
      dateKey: d.dateKey,
      dayNumber: d.dayNumber,
      position: 'future' as DayPosition,
      items: d.items,
    }));
  }

  // Classify each day against the viewer's today, then split off the
  // leading run of past (collapsed) days. The split key set is what a
  // continuation's check-in day must fall inside to qualify.
  const classified = days.map((d) => ({
    ...d,
    position: classifyDay(parseDateKey(d.dateKey), clientToday),
  }));
  const collapsedKeys = new Set(splitCollapsedDays(classified).collapsed.map((d) => d.key));

  // Gather candidates from every COLLAPSED day, tagged with their
  // check-in day key so a continuation never doubles up on its own
  // check-in day (which is collapsed anyway).
  const fromCollapsed: Array<{ candidate: RailContinuationCandidate; bucketKey: string }> = [];
  for (const day of classified) {
    if (!collapsedKeys.has(day.key)) continue;
    for (const candidate of day.continuationCandidates) {
      fromCollapsed.push({ candidate, bucketKey: day.key });
    }
  }

  return classified.map((day) => {
    // Collapsed days render their own rows only — no continuations are
    // surfaced onto a day that's itself folded away.
    if (collapsedKeys.has(day.key) || fromCollapsed.length === 0) {
      return {
        key: day.key,
        dateKey: day.dateKey,
        dayNumber: day.dayNumber,
        position: day.position,
        items: day.items,
      };
    }
    const dayDate = parseDateKey(day.dateKey);
    const contItems: RailItem[] = [];
    for (const { candidate, bucketKey } of fromCollapsed) {
      if (bucketKey === day.key) continue;
      if (
        continuesThroughDay({ startsAt: candidate.startsAt, endsAt: candidate.endsAt }, dayDate)
      ) {
        // Stamp the hotel check-out time on the stay's FINAL day only — the
        // day whose local calendar date matches the check-out instant.
        // Local-day math (not UTC) so it lands on whatever day the last
        // continuation row actually renders, mirroring continuationCheckOutTime.
        const isCheckOutDay = startOfLocalDay(candidate.endsAt) === startOfLocalDay(dayDate);
        contItems.push(
          isCheckOutDay && candidate.checkOutTime
            ? { ...candidate.item, continuationCheckOut: candidate.checkOutTime }
            : candidate.item,
        );
      }
    }
    return {
      key: day.key,
      dateKey: day.dateKey,
      dayNumber: day.dayNumber,
      position: day.position,
      // Continuations lead the day (a persistent backdrop), then the
      // day's own segments — matching the old server-baked ordering.
      items: contItems.length > 0 ? [...contItems, ...day.items] : day.items,
    };
  });
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
export function mappableSegmentIds(day: ResolvedRailDay): string[] {
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
