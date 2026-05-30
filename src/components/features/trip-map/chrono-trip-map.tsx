'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import type {
  GeocodeWorkerStatus,
  TripMapArc,
  TripMapPin,
  UngeocodedSegment,
  WishlistMapPin,
} from '@/lib/trip-map/repo';

import { mappableSegmentIds, type RailDay } from './timeline-model';
import { TripMap } from './trip-map';
import { TripTimelineRail } from './trip-timeline-rail';
import { TripTimelineSheet } from './trip-timeline-sheet';

interface ChronoTripMapProps {
  tripId: string;
  pins: TripMapPin[];
  arcs: TripMapArc[];
  ungeocoded: UngeocodedSegment[];
  countries: Array<{ code: string; name: string }>;
  activeCountry: string | null;
  wishlistPins: WishlistMapPin[];
  geocodeWorkerStatus: GeocodeWorkerStatus;
  /** Day-grouped, classified, map-joined rail data (built server-side). */
  days: RailDay[];
  /** True only for `trip.status === 'active'`. */
  isActive: boolean;
}

/**
 * Chronological trip-map orchestrator (issue #9). Evolves the existing
 * `/trips/[id]/map` surface from spatial-only into temporal-primary:
 * the day-grouped timeline is the main control and the map is a
 * projection of the selected time window.
 *
 * Owns the shared interaction state and wires it both ways:
 *   - `focusedDayKey` (URL `?day=`) → fitBounds to that day + highlight;
 *   - `hoveredDayKey` (ephemeral, laptop only) → highlight without fit;
 *   - `selectedSegmentId` → pan the map to that segment + open tooltip.
 *
 * The country chip strip (`?country=`) stays an orthogonal SPATIAL
 * control living inside TripMap; the timeline is the TEMPORAL control.
 * Their dim sources compose in TripMap (a pin shows full opacity only
 * when it passes the country filter AND the active day highlight).
 *
 * Layout:
 *   - laptop (lg+): a fixed-width left rail beside a sticky map;
 *   - mobile (<lg): a full-bleed map with a vaul bottom sheet.
 * The same `TripTimelineRail` content backs both.
 */
export function ChronoTripMap({
  tripId,
  pins,
  arcs,
  ungeocoded,
  countries,
  activeCountry,
  wishlistPins,
  geocodeWorkerStatus,
  days,
  isActive,
}: ChronoTripMapProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The live `?day=` is the single source of truth for the focused day,
  // read straight off the URL so back/forward, shared links, AND unfocus
  // (clearing the param) all round-trip — no server-prop fallback, which
  // would otherwise re-apply a deep-linked day after the user cleared it.
  // A day not present in `days` (stale link, or a shape-invalid value)
  // resolves to no focus rather than an empty highlight.
  const dayParam = searchParams.get('day');
  const focusedDayKey = React.useMemo(
    () => (dayParam && days.some((d) => d.key === dayParam) ? dayParam : null),
    [dayParam, days],
  );

  // Ephemeral hover (laptop hover-capable only). Never written to the
  // URL — it's a transient highlight, not shareable state.
  const [hoveredDayKey, setHoveredDayKey] = React.useState<string | null>(null);

  // The selected segment (clicked rail row or tapped map pin). Drives
  // the map focus (pan + tooltip) and the rail's pressed state.
  const [selectedSegmentId, setSelectedSegmentId] = React.useState<string | null>(null);
  // Bumped whenever a focus is requested so TripMap re-flies even when
  // the same segment id is re-selected.
  const [focusNonce, setFocusNonce] = React.useState(0);
  const [focusSegmentId, setFocusSegmentId] = React.useState<string | null>(null);

  const dayByKey = React.useMemo(() => {
    const m = new Map<string, RailDay>();
    for (const d of days) m.set(d.key, d);
    return m;
  }, [days]);

  // The active highlight set: hover wins over focus (a hover is a
  // momentary "preview this day" gesture on top of whatever day is
  // focused). null = no day highlight, so only the country filter dims.
  // A day with NOTHING mappable (e.g. a notes-only day) also yields null
  // — highlighting an empty set would dim every pin on the map, and
  // focusing a day you can't place shouldn't grey the whole world.
  const highlightSegmentIds = React.useMemo<ReadonlySet<string> | null>(() => {
    const key = hoveredDayKey ?? focusedDayKey;
    if (!key) return null;
    const day = dayByKey.get(key);
    if (!day) return null;
    const ids = mappableSegmentIds(day);
    return ids.length > 0 ? new Set(ids) : null;
  }, [hoveredDayKey, focusedDayKey, dayByKey]);

  // The fitBounds target: the focused day's mappable ids (hover does NOT
  // refit — it only dims, so a hover doesn't yank the camera). null when
  // no day is focused (or the focused day has nothing mappable), handing
  // the frame back to TripMap's country/all fit. A fresh array per focus
  // change is the fit effect's retrigger — no nonce needed (there's no
  // affordance to re-focus the already-focused day; a repeat click
  // unfocuses it).
  const fitToSegmentIds = React.useMemo<readonly string[] | null>(() => {
    if (!focusedDayKey) return null;
    const day = dayByKey.get(focusedDayKey);
    if (!day) return null;
    const ids = mappableSegmentIds(day);
    return ids.length > 0 ? ids : null;
  }, [focusedDayKey, dayByKey]);

  // Build a `?day=` href that preserves the country filter. Toggling the
  // already-focused day clears the focus (a second click "unfocuses").
  const writeDay = React.useCallback(
    (dayKey: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (dayKey) params.set('day', dayKey);
      else params.delete('day');
      const q = params.toString();
      // `replace` (not push) + `scroll: false`: focusing a day is a view
      // tweak, not a navigation — it shouldn't stack history entries or
      // jump the page to the top. Matches the country chip's `replace`.
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const onFocusDay = React.useCallback(
    (dayKey: string) => {
      // Focusing (or unfocusing) a day clears any segment selection — a
      // previously-clicked pin shouldn't linger as the map's focus and
      // yank the camera back to it instead of framing the day (or zooming
      // out on unfocus). Re-focusing the focused day unfocuses it.
      setSelectedSegmentId(null);
      setFocusSegmentId(null);
      writeDay(focusedDayKey === dayKey ? null : dayKey);
    },
    [writeDay, focusedDayKey],
  );

  const onHoverDay = React.useCallback((dayKey: string | null) => {
    setHoveredDayKey(dayKey);
  }, []);

  // Select a single segment — pan the map + open its tooltip. Bumping
  // the nonce forces a re-fly even if it's the same id.
  const onSelectSegment = React.useCallback((segmentId: string) => {
    setSelectedSegmentId(segmentId);
    setFocusSegmentId(segmentId);
    setFocusNonce((n) => n + 1);
  }, []);

  // Map-pin tap → reflect into the rail's selection (no extra fly: the
  // map already flew on its own click). We deliberately don't bump the
  // focus nonce here, so this doesn't fight the map's own flyTo.
  const onPinClick = React.useCallback((segmentId: string) => {
    setSelectedSegmentId(segmentId);
  }, []);

  // Map-pin hover (laptop) → highlight the owning day so hovering a pin
  // lights up its day in the rail's dim logic, symmetric with hovering
  // a day lighting up its pins. We map the pin back to its day via the
  // segment id.
  const segmentToDayKey = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const day of days) {
      for (const item of day.items) m.set(item.segmentId, day.key);
    }
    return m;
  }, [days]);
  const onPinHover = React.useCallback(
    (segmentId: string | null) => {
      setHoveredDayKey(segmentId ? (segmentToDayKey.get(segmentId) ?? null) : null);
    },
    [segmentToDayKey],
  );

  const hasDays = days.length > 0;

  const railProps = {
    tripId,
    days,
    isActive,
    focusedDayKey,
    selectedSegmentId,
    onFocusDay,
    onHoverDay,
    onSelectSegment,
  };

  // Shared map driving props — only the height / attribution differ
  // between the laptop column and the mobile full-bleed surface.
  const mapDrivingProps = {
    pins,
    arcs,
    ungeocoded,
    countries,
    activeCountry,
    tripId,
    wishlistPins,
    geocodeWorkerStatus,
    highlightSegmentIds,
    focusSegmentId,
    focusNonce,
    fitToSegmentIds,
    fitKey: focusedDayKey,
    onPinClick,
    onPinHover,
  };

  return (
    <>
      {/*
        ONE map instance, ONE layout that reflows by breakpoint:
          - laptop (lg+): the rail is an inline column to the left; the
            map fills the rest. Both share a height so the columns align.
          - mobile (<lg): the rail column is hidden (the vaul sheet
            renders the same content instead) and the map takes the full
            width and nearly the full viewport height.
        Rendering the map once avoids two live MapLibre WebGL contexts.
      */}
      <div className="flex gap-6">
        {/* The rail only earns its column when the trip has dated days.
            An empty trip (new, or wishlist-only) would otherwise show a
            blank bordered panel on laptop — so hide it and let the map
            take the full width, mirroring the sheet's empty-trip null. */}
        {hasDays && (
          <aside
            aria-label="Trip timeline"
            className="border-foreground/10 bg-card/50 hidden w-[360px] shrink-0 overflow-y-auto rounded-2xl border p-3 lg:block xl:w-[400px]"
            style={{ height: 'min(calc(100svh - 200px), 640px)' }}
          >
            <TripTimelineRail {...railProps} />
          </aside>
        )}
        <div className="min-w-0 flex-1">
          <TripMap
            {...mapDrivingProps}
            // Near-full-height on phone (the sheet floats over the
            // bottom); rail-matched on laptop. Responsive class so a
            // single instance covers both — see TripMap.mapHeightClassName.
            mapHeightClassName="h-[calc(100svh-180px)] lg:h-[min(calc(100svh-200px),640px)]"
            hideAttribution
          />
        </div>
      </div>

      {/* Mobile bottom sheet — the same rail content, lg:hidden so it
       *  only exists on phone / small tablet. */}
      <TripTimelineSheet hasDays={hasDays} {...railProps} />
    </>
  );
}
