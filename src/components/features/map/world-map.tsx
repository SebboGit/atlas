'use client';

import maplibregl, { type Map as MapLibreMap, type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { VisitedCountry } from '@/lib/countries/repo';
import { cn } from '@/lib/utils';

interface VisitedCountryWithName extends VisitedCountry {
  name: string;
}

interface WorldMapProps {
  visited: VisitedCountryWithName[];
}

interface HoverInfo {
  /** Pixel coordinates within the map container. */
  x: number;
  y: number;
  /** Map canvas dimensions, used to flip the tooltip near edges. */
  containerWidth: number;
  containerHeight: number;
  country: VisitedCountryWithName;
}

const GEOJSON_URL = '/geo/world-countries-110m.geojson';
const SOURCE_ID = 'countries';
const FILL_LAYER_ID = 'country-fill';
const LINE_LAYER_ID = 'country-line';

// Ocean / map canvas. Light enough to feel like sea on paper.
const OCEAN = '#eaeef2';
// Terracotta fallback if `--color-primary` isn't readable from CSS yet.
const PRIMARY_FALLBACK = '#9b4a26';

function readCssColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return val || fallback;
}

export function WorldMap({ visited }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  // Gated by the map's 'load' event — until the GeoJSON source is added we
  // can't setFeatureState or attach layer-scoped listeners.
  const [mapReady, setMapReady] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const visitedIndex = useMemo(() => {
    const m = new Map<string, VisitedCountryWithName>();
    for (const c of visited) m.set(c.code.toUpperCase(), c);
    return m;
  }, [visited]);

  // Mount the map exactly once. No data-bound logic here — that lives in
  // a separate effect that re-binds whenever `visited` changes, so the
  // mount effect's deps stay empty without any ref-mirroring tricks.
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'ocean', type: 'background', paint: { 'background-color': OCEAN } }],
      },
      center: [10, 20],
      zoom: 0.4,
      minZoom: 0.4,
      maxZoom: 5,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      // Single world only — duplicating horizontally on a "where you've
      // been" view turns one Malaysia into three and confuses the
      // mental model. fitBounds below frames the world to the
      // container's actual aspect.
      renderWorldCopies: false,
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();

    // Surface any internal MapLibre error to the console — silent
    // worker failures (e.g. CSP blocking blob: workers) otherwise
    // present as a blank canvas with no visible signal.
    map.on('error', (e) => {
      console.error('[world-map] maplibre error', e.error ?? e);
    });

    // MapLibre takes its initial canvas size from the container's
    // bounding box at construction time. Inside a flex/aspect-ratio
    // parent (or one revealed via animation), that box can briefly be
    // 0×0 — the canvas then stays at 0px even after layout resolves.
    // A ResizeObserver keeps the canvas in sync with later layout
    // changes (window resize, devtools open, etc.).
    const ro = new ResizeObserver(() => {
      map.resize();
    });
    ro.observe(containerRef.current);

    map.on('load', () => {
      // Frame the populated world (everything south of ~55°S is just
      // Antarctica; everything north of ~78°N is Greenland ice). The
      // longitude spans the full 360° so no axis is cropped.
      map.fitBounds(
        [
          [-180, -55],
          [180, 78],
        ],
        { padding: 12, animate: false, duration: 0 },
      );

      const primary = readCssColor('--color-primary', PRIMARY_FALLBACK);
      const borderInk = 'rgba(28, 22, 14, 0.35)';
      const unvisitedFill = 'rgba(28, 22, 14, 0.06)';

      map.addSource(SOURCE_ID, { type: 'geojson', data: GEOJSON_URL, promoteId: 'iso_a2' });

      map.addLayer({
        id: FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'visited'], false],
            primary,
            unvisitedFill,
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hovered'], false],
            0.95,
            ['boolean', ['feature-state', 'visited'], false],
            0.78,
            1,
          ],
        },
      });

      map.addLayer({
        id: LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': borderInk,
          'line-width': ['case', ['boolean', ['feature-state', 'hovered'], false], 1.1, 0.5],
          'line-opacity': 0.55,
        },
      });

      setMapReady(true);
    });

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      hoveredIdRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Re-apply visited fills + hover listeners whenever the visited set
  // changes. Listeners are recreated so their closure over `visitedIndex`
  // is always current — cheap because MapLibre's `off` is a simple
  // unbind, and visited rarely changes during a session.
  //
  // Cleanup order on unmount matters: React runs effect cleanups in
  // reverse mount order, so this effect's `map.off()` calls run before
  // the mount effect's `map.remove()`. Keep it that way — touching a
  // removed map throws.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    applyVisitedFeatureStates(map, visitedIndex);

    const handleMouseMove = (e: maplibregl.MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      const feature = e.features?.[0];
      const rawId = feature?.id;
      const id = typeof rawId === 'string' ? rawId.toUpperCase() : null;
      const country = id ? visitedIndex.get(id) : undefined;

      if (hoveredIdRef.current && hoveredIdRef.current !== id) {
        map.setFeatureState({ source: SOURCE_ID, id: hoveredIdRef.current }, { hovered: false });
        hoveredIdRef.current = null;
      }

      if (country && id) {
        map.setFeatureState({ source: SOURCE_ID, id }, { hovered: true });
        hoveredIdRef.current = id;
        map.getCanvas().style.cursor = 'pointer';
        const { width, height } = map.getCanvas().getBoundingClientRect();
        setHover({
          x: e.point.x,
          y: e.point.y,
          country,
          containerWidth: width,
          containerHeight: height,
        });
      } else {
        map.getCanvas().style.cursor = '';
        setHover(null);
      }
    };

    const handleMouseLeave = () => {
      if (hoveredIdRef.current) {
        map.setFeatureState({ source: SOURCE_ID, id: hoveredIdRef.current }, { hovered: false });
        hoveredIdRef.current = null;
      }
      map.getCanvas().style.cursor = '';
      setHover(null);
    };

    map.on('mousemove', FILL_LAYER_ID, handleMouseMove);
    map.on('mouseleave', FILL_LAYER_ID, handleMouseLeave);

    return () => {
      map.off('mousemove', FILL_LAYER_ID, handleMouseMove);
      map.off('mouseleave', FILL_LAYER_ID, handleMouseLeave);
    };
  }, [visitedIndex, mapReady]);

  return (
    // The MapLibre container IS the visual card. We can't wrap a
    // separate inner div for chrome because MapLibre injects its own
    // class (`.maplibregl-map { position: relative }`) onto whatever
    // element you hand it, which silently overrides Tailwind's
    // `absolute` (same specificity, MapLibre's stylesheet wins the
    // cascade). The inner div then has no intrinsic size and collapses
    // to 0px tall. So: single div, sized explicitly, with the tooltip
    // as the only sibling under a wrapper that handles overlay layout.
    <div className="relative w-full">
      <div
        ref={containerRef}
        className="border-foreground/10 bg-card/65 w-full overflow-hidden rounded-2xl border shadow-[0_18px_40px_-28px_rgba(60,40,20,0.25)]"
        // Reserve ~320px below the map for: 64px sticky topbar + the
        // /map page chrome above + the attribution line below + a
        // comfortable bottom gap. svh (not dvh) is intentional: dvh
        // expands as the mobile URL bar collapses, which would resize
        // the map mid-scroll. svh locks to the smallest viewport so
        // the map stays a stable height regardless of scroll state.
        style={{ height: 'min(calc(100svh - 320px), 560px)' }}
        aria-label="World map of visited countries"
      />
      {hover && (
        <MapTooltip
          x={hover.x}
          y={hover.y}
          containerWidth={hover.containerWidth}
          containerHeight={hover.containerHeight}
          country={hover.country}
        />
      )}
    </div>
  );
}

/**
 * Floating card driven by the cursor. Biases up-and-right of the
 * pointer and flips across an axis near container edges so it stays
 * readable in any corner.
 *
 * Three caption variants:
 *   - Trip-derived only:   "3 trips · Last May 2025"
 *   - Manually marked only: "Marked as visited"
 *   - Both:                "3 trips · Last May 2025 · Also marked"
 */
function MapTooltip({
  x,
  y,
  containerWidth,
  containerHeight,
  country,
}: {
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
  country: VisitedCountryWithName;
}) {
  const flipX = x > 0.65 * containerWidth ? -100 : 0;
  const flipY = y < 0.18 * containerHeight ? 12 : -100;

  return (
    <div
      role="tooltip"
      className={cn(
        'pointer-events-none absolute z-10 max-w-[14rem] rounded-lg border px-3 py-2',
        'border-foreground/15 bg-card/95 shadow-[0_10px_24px_-12px_rgba(60,40,20,0.35)] backdrop-blur-sm',
      )}
      style={{
        left: x,
        top: y,
        transform: `translate(calc(${flipX}% + ${flipX === 0 ? 14 : -14}px), calc(${flipY}% + ${flipY > 0 ? 14 : -14}px))`,
      }}
    >
      <p className="font-display text-foreground text-sm leading-tight font-medium tracking-tight">
        {country.name}
      </p>
      <p className="text-muted-foreground mt-1 font-mono text-[10px] tracking-[0.18em] uppercase">
        {tooltipCaption(country)}
      </p>
    </div>
  );
}

function tooltipCaption(country: VisitedCountryWithName): string {
  const parts: string[] = [];
  if (country.tripCount > 0) {
    parts.push(`${country.tripCount} ${country.tripCount === 1 ? 'trip' : 'trips'}`);
    if (country.lastVisitAt) parts.push(`Last ${formatMonthYear(country.lastVisitAt)}`);
    if (country.manuallyMarked) parts.push('Also marked');
  } else if (country.manuallyMarked) {
    parts.push('Marked as visited');
  }
  return parts.join(' · ');
}

// "May 2025" — UTC-based to match the storage TZ semantics of
// timestamptz `mode: 'date'`. A trip ending on Jun 1 reads "Jun 2025"
// which is the correct calendar truth and needs no schema change to
// disambiguate month-spanning trips.
function formatMonthYear(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function applyVisitedFeatureStates(map: MapLibreMap, index: Map<string, VisitedCountryWithName>) {
  // The 110m dataset is small enough (~180 features) that wiping all
  // feature-state and re-stamping every visited code is cheap and
  // keeps this function idempotent.
  map.removeFeatureState({ source: SOURCE_ID });
  for (const code of index.keys()) {
    map.setFeatureState({ source: SOURCE_ID, id: code }, { visited: true });
  }
}
