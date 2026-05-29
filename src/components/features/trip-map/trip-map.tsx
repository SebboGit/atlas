'use client';

import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type {
  GeocodeWorkerStatus,
  TripMapArc,
  TripMapPin,
  UngeocodedSegment,
  WishlistMapPin,
} from '@/lib/trip-map/repo';

import { curvedArcCoords } from './arc-geometry';
import { buildBasemapStyle } from './basemap-style';
import { CountryChipStrip } from './country-chip-strip';
import { GeocodeWorkerBanner } from './geocode-worker-banner';
import { PinMarker } from './pin-marker';
import { PinTooltip } from './pin-tooltip';
import { NotPinnedChip } from './not-pinned-chip';

// Register the pmtiles:// protocol with MapLibre on module load.
// MapLibre intercepts source URLs starting with `pmtiles://` and
// resolves them via this handler, which uses HTTP Range requests
// against the underlying URL. Doing it at module scope (not in an
// effect) means it's set before the first map instance constructs
// its style. `addProtocol` overwrites any prior registration of the
// same scheme, so this is safe under HMR re-evaluations. See
// ADR-0011.
if (typeof window !== 'undefined') {
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
}

interface TripMapProps {
  pins: TripMapPin[];
  arcs: TripMapArc[];
  ungeocoded: UngeocodedSegment[];
  countries: Array<{ code: string; name: string }>;
  /** Active ISO 3166-1 alpha-2 from `?country=XX`; null = "All". */
  activeCountry: string | null;
  /** Used by the chip strip to build country-filter hrefs. */
  tripId: string;
  /**
   * Muted overlay pins for wishlist items in this trip's countries
   * that aren't already on the trip. Drawn as a separate, low-weight
   * marker layer behind a toggle. Defaults to off; the toggle state
   * persists per-trip in localStorage.
   */
  wishlistPins?: WishlistMapPin[];
  /**
   * Whether geocoding can resolve this trip's pending pins. Drives the
   * banner above the map; `'ok'` (the default) renders nothing. See
   * issue #24.
   */
  geocodeWorkerStatus?: GeocodeWorkerStatus;
}

interface HoverInfo {
  /** Cursor x within the map container. */
  x: number;
  /** Cursor y within the map container. */
  y: number;
  containerWidth: number;
  containerHeight: number;
  pin: TripMapPin;
}

const COUNTRIES_GEOJSON_URL = '/geo/world-countries-110m.geojson';
const COUNTRIES_SOURCE_ID = 'countries';
const COUNTRIES_FILL_LAYER_ID = 'country-fill';
const COUNTRIES_LINE_LAYER_ID = 'country-line';
const ARCS_SOURCE_ID = 'trip-arcs';
const ARCS_LAYER_ID = 'trip-arcs-lines';

// Background colour for the area outside the basemap's data extent
// (or when the tile file is missing). Matches the Protomaps White
// theme's `background.color` for the cleanest seam.
const PRIMARY_FALLBACK = '#9b4a26';
// Country fill is intentionally a barely-there neutral — this map is
// about the pins on top, not which countries are "visited".
const COUNTRY_FILL = 'rgba(28, 22, 14, 0.045)';
const COUNTRY_LINE = 'rgba(28, 22, 14, 0.28)';

// Same framing as the global /map view — populated world, no
// Antarctica / Greenland-ice padding. Used as the fallback frame
// when a trip has no pins (yet).
const DEFAULT_WORLD_BOUNDS: LngLatBoundsLike = [
  [-180, -55],
  [180, 78],
];

// Target zoom when the user clicks a pin. Z12 is neighbourhood-scale
// on the Protomaps basemap — close enough to read individual streets
// next to a hotel pin without diving past the Z13 tile ceiling. The
// flyTo guards on `Math.max(currentZoom, this)` so a user who's
// already pulled in tighter never gets zoomed back out.
const PIN_CLICK_ZOOM = 12;

function readCssColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return val || fallback;
}

// Tiny HTML escaper for the wishlist marker popup. Popup content is
// built as raw HTML so labels containing user-typed brackets, quotes,
// or ampersands need escaping or we'd inject broken markup. Five
// chars cover the relevant XSS attack surface for HTML text content.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A live MapLibre marker plus the React root that owns its DOM. We
// keep both around so the marker-sync effect can update prop-driven
// state (hovered/dimmed) on existing markers cheaply and tear them
// down cleanly on unmount.
interface ManagedMarker {
  marker: maplibregl.Marker;
  root: Root;
  el: HTMLDivElement;
}

function arcsToFeatureCollection(arcs: TripMapArc[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: arcs.map((arc, idx) => ({
      type: 'Feature',
      id: idx,
      geometry: {
        type: 'MultiLineString',
        coordinates: curvedArcCoords(arc),
      },
      properties: {
        idx,
        originCountry: arc.originCountry ?? '',
        destCountry: arc.destCountry ?? '',
      },
    })),
  };
}

export function TripMap({
  pins,
  arcs,
  ungeocoded,
  countries,
  activeCountry,
  tripId,
  wishlistPins = [],
  geocodeWorkerStatus = 'ok',
}: TripMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<ManagedMarker[]>([]);
  // Wishlist overlay markers are kept separate from the main pin
  // markers so toggling the overlay (or wishlistPins changing) never
  // disturbs the segment-pin lifecycle.
  const wishlistMarkersRef = useRef<maplibregl.Marker[]>([]);
  // Default off — the overlay is a hint, not the primary surface.
  // Persisted per-trip so toggling stays sticky across reloads. The
  // toggle function below writes localStorage and updates state
  // together so we don't read-then-set inside an effect (the
  // react-hooks/set-state-in-effect rule blocks the obvious shape).
  const { showWishlist, setShowWishlist } = useWishlistOverlayState(tripId);
  const hoveredIdxRef = useRef<number | null>(null);
  const firstFitDoneRef = useRef(false);
  // activeCountry mirrored into a ref so the pin-sync effect's hover
  // handlers (which don't re-bind on activeCountry change) can derive
  // the dim state when re-rendering a marker.
  const activeCountryRef = useRef(activeCountry);
  useEffect(() => {
    activeCountryRef.current = activeCountry;
  }, [activeCountry]);
  // Gated by the map's 'load' event — until the arcs source is added
  // we can't setFeatureState on it.
  const [mapReady, setMapReady] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  // hover mirrored into a ref so the mount effect's 'move' handler —
  // bound once — can reproject the active pin without re-binding every
  // time hover state changes.
  const hoverRef = useRef<HoverInfo | null>(null);
  useEffect(() => {
    hoverRef.current = hover;
  }, [hover]);
  // pins mirrored into a ref for the same reason: when the dismissal
  // path inside the once-bound move/click handler needs to reset the
  // active pin's React root back to the non-hovered visual, it reads
  // the current pin data from here without re-binding on every prop
  // change.
  const pinsRef = useRef(pins);
  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);

  const showChips = countries.length >= 2;
  const showEmptyState = pins.length === 0 && arcs.length === 0 && ungeocoded.length === 0;

  // Mount the map exactly once. Data-bound logic lives in separate
  // effects so this stays stable across pin/country changes.
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // Self-hosted Protomaps White basemap. The pmtiles JS library
      // (registered above) handles the byte-range fetches against
      // /tiles/world.pmtiles. If the tile file is missing (operator
      // hasn't run `pmtiles extract` yet) the basemap renders empty
      // and we still get country polygons + arcs on top — graceful
      // degradation rather than a hard error.
      style: buildBasemapStyle(),
      center: [10, 20],
      zoom: 0.4,
      minZoom: 0.4,
      // Z13 matches the basemap's detail ceiling per ADR-0011 — no
      // point letting the user zoom past where the tiles run out.
      maxZoom: 13,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      renderWorldCopies: false,
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();

    map.on('error', (e) => {
      console.error('[trip-map] maplibre error', e.error ?? e);
    });

    // Keep the canvas in sync with later layout changes (devtools,
    // window resize, parent flex shifts). Same pattern as world-map.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    // Dismissal helper. The per-pin mouseenter/mouseleave handlers
    // already drive the hovered/non-hovered visual on hover-capable
    // devices, but on touch `mouseleave` is unreliable — tapping a
    // pin and then panning the map closes the tooltip via the move
    // handler below, but the pin's React root stays in the hovered
    // visual unless we reset it here too. And because
    // `hoveredIdxRef.current` would stay pointing at the same pin,
    // a subsequent tap on that pin doesn't re-fire its mouseenter
    // logic (the handler treats it as "already hovered") so the
    // tooltip wouldn't re-open either. Clearing both pieces of state
    // alongside setHover(null) keeps the pin behaving like a fresh
    // target on the next tap.
    function dismissActivePin() {
      const idx = hoveredIdxRef.current;
      if (idx !== null) {
        const managed = markersRef.current[idx];
        const pin = pinsRef.current[idx];
        if (managed && pin) {
          const ac = activeCountryRef.current;
          managed.root.render(
            <PinMarker
              kind={pin.kind}
              label={pin.label}
              hovered={false}
              dimmed={ac !== null && pin.country !== ac}
            />,
          );
        }
        hoveredIdxRef.current = null;
      }
      setHover(null);
    }

    // User-initiated dismissal — listen directly on the WebGL canvas
    // for raw DOM events. MapLibre's 'dragstart' / 'movestart' with
    // originalEvent both turned out unreliable for touch pan; raw
    // touchstart/mousedown/wheel always fire on any direct user
    // interaction, and the programmatic flyTo never dispatches DOM
    // events to the canvas so it can't accidentally trip dismissal.
    //
    // Pin markers are absolute HTML overlays above the canvas, so a
    // tap on a pin doesn't reach the canvas's touchstart — only taps
    // on empty map surface (or the start of a pan) do. Background
    // taps therefore dismiss via the same path as a real drag start,
    // which is exactly what we want.
    const canvas = map.getCanvas();
    function userDismiss() {
      if (hoverRef.current) dismissActivePin();
    }
    canvas.addEventListener('touchstart', userDismiss, { passive: true });
    canvas.addEventListener('mousedown', userDismiss);
    canvas.addEventListener('wheel', userDismiss, { passive: true });

    // Programmatic move (pin tap → flyTo zooms in): reproject the
    // tooltip onto the pin's new screen coords every frame so it
    // stays glued through the animation. flyTo lands ON the pin, so
    // the tooltip can't escape the map container during the
    // animation. User-initiated moves already dismissed above (their
    // initiating DOM event fired before this 'move' handler runs),
    // so hoverRef.current is null for them and we bail early.
    map.on('move', () => {
      const h = hoverRef.current;
      if (!h) return;
      const point = map.project([h.pin.lng, h.pin.lat]);
      const rect = map.getCanvas().getBoundingClientRect();
      setHover({
        x: point.x,
        y: point.y,
        pin: h.pin,
        containerWidth: rect.width,
        containerHeight: rect.height,
      });
    });

    // Background tap also dismisses via MapLibre's filtered click
    // (pin clicks stopPropagation, so this fires only for empty
    // canvas). Redundant with the canvas touchstart above for touch
    // but covers the mouse-click-without-drag case cleanly.
    map.on('click', () => dismissActivePin());

    map.on('load', () => {
      map.fitBounds(DEFAULT_WORLD_BOUNDS, { padding: 12, animate: false, duration: 0 });

      // Country polygons — visual texture only, not data. They sit
      // ABOVE the basemap layers (added last, so the highest-z
      // layer at insertion time) and fade out as the user zooms in
      // so the basemap's city / street detail can come through. At
      // world zoom (the default) the polygons read as the headline
      // texture; by Z6+ the basemap dominates.
      map.addSource(COUNTRIES_SOURCE_ID, {
        type: 'geojson',
        data: COUNTRIES_GEOJSON_URL,
        promoteId: 'iso_a2',
      });
      map.addLayer({
        id: COUNTRIES_FILL_LAYER_ID,
        type: 'fill',
        source: COUNTRIES_SOURCE_ID,
        paint: {
          'fill-color': COUNTRY_FILL,
          // Prominent at world view, gone by neighbourhood view.
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 2, 1, 6, 0],
        },
      });
      map.addLayer({
        id: COUNTRIES_LINE_LAYER_ID,
        type: 'line',
        source: COUNTRIES_SOURCE_ID,
        paint: {
          'line-color': COUNTRY_LINE,
          'line-width': 0.5,
          // Lines linger a beat longer than the fill so country
          // boundaries remain identifiable at country / city zoom.
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.55, 7, 0],
        },
      });

      const primary = readCssColor('--color-primary', PRIMARY_FALLBACK);

      // Arcs render BEFORE pins so the DOM markers (added later via
      // maplibregl.Marker — those go in a separate DOM overlay above
      // the canvas) sit above their endpoints.
      map.addSource(ARCS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: ARCS_LAYER_ID,
        type: 'line',
        source: ARCS_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': primary,
          'line-width': 1.5,
          // Dimmed = arc isn't fully within the active country (when a
          // chip is active). Otherwise a soft default so arcs read as
          // connective tissue, not the headline.
          'line-opacity': ['case', ['boolean', ['feature-state', 'dimmed'], false], 0.12, 0.55],
        },
      });

      setMapReady(true);
    });

    return () => {
      // Tear down markers + their React roots before destroying the
      // map. unmount() must be deferred — calling it inside the
      // unmount itself triggers React's "called from within unmount"
      // warning.
      const managed = markersRef.current;
      markersRef.current = [];
      queueMicrotask(() => {
        for (const m of managed) {
          m.marker.remove();
          m.root.unmount();
        }
      });
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      hoveredIdxRef.current = null;
      firstFitDoneRef.current = false;
      setMapReady(false);
    };
  }, []);

  // Re-create the DOM marker set whenever `pins` changes. For our
  // pin counts (<100 per trip), tearing down and re-mounting on prop
  // changes is cheap and keeps the code linear. We do NOT diff by
  // segmentId today — when a trip has 1000+ pins that becomes
  // worthwhile, but we're nowhere near.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Tear down the previous batch. `marker.remove()` is a DOM op
    // and can run synchronously; `root.unmount()` is a React op and
    // throws "synchronously unmount a root while React was already
    // rendering" if we call it inside an effect during the same
    // commit — defer it to a microtask so the current render finishes
    // first. Same trick the mount cleanup uses.
    const stale = markersRef.current;
    markersRef.current = [];
    hoveredIdxRef.current = null;
    setHover(null);
    for (const m of stale) m.marker.remove();
    queueMicrotask(() => {
      for (const m of stale) m.root.unmount();
    });

    // Single source of truth for what props a marker should render
    // with, given its current hover state. Dim is derived from the
    // (ref-mirrored) activeCountry so a country-narrow view stays
    // consistent across hovers without re-running this effect.
    function renderProps(pin: TripMapPin, hovered: boolean) {
      const ac = activeCountryRef.current;
      return {
        kind: pin.kind,
        label: pin.label,
        hovered,
        dimmed: ac !== null && pin.country !== ac,
      };
    }

    const managed: ManagedMarker[] = pins.map((pin, idx) => {
      const el = document.createElement('div');
      el.style.cursor = 'pointer';
      const root = createRoot(el);
      root.render(<PinMarker {...renderProps(pin, false)} />);

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);

      // Shared open-the-tooltip logic so both mouseenter (desktop
      // hover) and click (touch tap) can fire it. The branch into
      // this helper from click is a touch workaround: after a
      // userDismiss has reset our state, the browser still
      // remembers the pin as "hovered", so a re-tap doesn't fire
      // mouseenter — only click does. Calling openTooltip from the
      // click handler bridges that gap.
      //
      // Re-acquires the map from the ref so TS keeps narrowing
      // inside this function declaration — the enclosing effect's
      // `map` const narrowing doesn't propagate into nested
      // function declarations.
      function openTooltip() {
        const m = mapRef.current;
        if (!m) return;
        const prev = hoveredIdxRef.current;
        if (prev !== null && prev !== idx) {
          const prevManaged = markersRef.current[prev];
          const prevPin = pins[prev];
          if (prevManaged && prevPin) {
            prevManaged.root.render(<PinMarker {...renderProps(prevPin, false)} />);
          }
        }
        hoveredIdxRef.current = idx;
        root.render(<PinMarker {...renderProps(pin, true)} />);
        // Flights show their IATA always-on as a fixed label, so the
        // floating card would just repeat the headline information.
        // Skip it for flights; non-flight pins (Phase 3b) still get
        // the card.
        if (pin.kind === 'flight') {
          setHover(null);
          return;
        }
        const rect = m.getCanvas().getBoundingClientRect();
        const point = m.project([pin.lng, pin.lat]);
        setHover({
          x: point.x,
          y: point.y,
          pin,
          containerWidth: rect.width,
          containerHeight: rect.height,
        });
      }

      el.addEventListener('mouseenter', openTooltip);

      el.addEventListener('mouseleave', () => {
        if (hoveredIdxRef.current === idx) hoveredIdxRef.current = null;
        root.render(<PinMarker {...renderProps(pin, false)} />);
        setHover(null);
      });

      el.addEventListener('click', (event) => {
        // Marker click → fly the camera to this pin and zoom in.
        // stopPropagation guards against the map-canvas click
        // handler (background-tap dismissal) firing from the same
        // pointer event. MapLibre's `flyTo` defaults to
        // `essential: false` so it collapses to an instant jump
        // under prefers-reduced-motion.
        event.stopPropagation();
        // Re-open the tooltip if our state says it's closed —
        // covers the touch case where mouseenter didn't fire on a
        // repeat tap because the browser still considered the pin
        // hovered. On a normal first tap mouseenter already opened
        // it and this is a no-op.
        if (hoveredIdxRef.current !== idx) openTooltip();
        map.flyTo({
          center: [pin.lng, pin.lat],
          zoom: Math.max(map.getZoom(), PIN_CLICK_ZOOM),
          duration: 800,
        });
      });

      return { marker, root, el };
    });

    markersRef.current = managed;

    return () => {
      // No teardown here — the next render's effect (or the mount
      // effect's cleanup) handles it. Tearing down both places
      // double-unmounts the React root.
    };
  }, [pins, mapReady]);

  // Push arcs into the source whenever they change. No hover handler
  // for v1 — arcs are decoration, not interactive content.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(ARCS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(arcsToFeatureCollection(arcs));
  }, [arcs, mapReady]);

  // Wishlist overlay markers. Independent of the main pin lifecycle —
  // creates / tears down on prop or toggle change. Each marker is a
  // small native DOM element with an inline-styled glyph so the look
  // isn't dependent on Tailwind seeing the runtime-built class string.
  // Click opens a maplibregl.Popup with the label + type, matching
  // segment pins' "click for detail" pattern.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Always rebuild — wishlistPins are short and this avoids managing
    // diff state for a feature that gets toggled in/out wholesale.
    for (const m of wishlistMarkersRef.current) m.remove();
    wishlistMarkersRef.current = [];

    if (!showWishlist) return;

    for (const pin of wishlistPins) {
      const el = document.createElement('div');
      // Inline style — Tailwind would tree-shake unknown runtime-built
      // class strings, leaving the marker invisible. Inline keeps the
      // muted-dotted-ring visual stable regardless of build pipeline.
      el.style.cssText = [
        'display:inline-flex',
        'align-items:center',
        'justify-content:center',
        'width:28px',
        'height:28px',
        'border-radius:9999px',
        'border:1.5px dashed rgba(28,22,14,0.45)',
        'background:rgba(255,253,248,0.85)',
        'color:rgba(28,22,14,0.65)',
        'backdrop-filter:blur(4px)',
        'box-shadow:0 1px 2px rgba(60,40,20,0.12)',
        'cursor:pointer',
        'transition:opacity 150ms ease',
        'opacity:0.85',
      ].join(';');
      el.setAttribute('role', 'button');
      el.setAttribute(
        'aria-label',
        `Wishlist ${pin.kind === 'food' ? 'food spot' : 'attraction'}: ${pin.label}`,
      );
      el.addEventListener('mouseenter', () => {
        el.style.opacity = '1';
      });
      el.addEventListener('mouseleave', () => {
        el.style.opacity = '0.85';
      });
      // Single SVG glyph — matches the wishlist-card iconography
      // (UtensilsCrossed for food, Sparkles for activity).
      el.innerHTML =
        pin.kind === 'food'
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/><path d="m2.1 21.8 6.4-6.3"/><path d="m19 5-7 7"/></svg>'
          : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>';

      // Popup mirrors PinTooltip's role for segment pins: click the
      // marker to surface what the pin represents. Native popup over
      // a React-rendered one because the wishlist overlay is
      // intentionally a lower-weight surface — no need for the full
      // hover-tracking machinery.
      const popupHtml = [
        '<div style="font-family:inherit;padding:2px 4px;min-width:120px">',
        '<div style="font-family:ui-monospace,monospace;font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(28,22,14,0.55)">',
        pin.kind === 'food' ? 'Wishlist · Food' : 'Wishlist · Activity',
        '</div>',
        '<div style="font-size:14px;font-weight:500;color:rgba(28,22,14,0.92);margin-top:3px;line-height:1.25">',
        escapeHtml(pin.label),
        '</div>',
        '</div>',
      ].join('');
      const popup = new maplibregl.Popup({
        offset: 18,
        closeButton: false,
        className: 'atlas-wishlist-popup',
      }).setHTML(popupHtml);

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([pin.lng, pin.lat])
        .setPopup(popup)
        .addTo(map);
      wishlistMarkersRef.current.push(marker);
    }

    return () => {
      // Unmount cleanup — the next effect run tears down too, but a
      // component unmount or HMR re-render takes this path.
      for (const m of wishlistMarkersRef.current) m.remove();
      wishlistMarkersRef.current = [];
    };
  }, [wishlistPins, showWishlist, mapReady]);

  // Re-apply dimming + re-frame on pin/arc/country changes. Pin
  // dimming runs through the React root for each managed marker;
  // arc dimming still uses MapLibre's feature-state (those are
  // line-layer features, not DOM).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    pins.forEach((pin, idx) => {
      const managed = markersRef.current[idx];
      if (!managed) return;
      const dimmed = activeCountry !== null && pin.country !== activeCountry;
      managed.root.render(<PinMarker kind={pin.kind} label={pin.label} dimmed={dimmed} />);
    });

    map.removeFeatureState({ source: ARCS_SOURCE_ID });
    if (activeCountry) {
      // Arc dims unless BOTH endpoints are in the active country. An
      // arc that straddles the active country and another is still
      // partly off-stage, so we mute it just like a half-on-screen
      // pin would feel out of focus.
      arcs.forEach((arc, idx) => {
        if (arc.originCountry !== activeCountry || arc.destCountry !== activeCountry) {
          map.setFeatureState({ source: ARCS_SOURCE_ID, id: idx }, { dimmed: true });
        }
      });
    }

    // fitBounds: prefer the active-country subset, fall back to
    // everything geographic on the trip (pins + arcs), fall back to
    // the default world frame.
    const matchedPins = activeCountry ? pins.filter((p) => p.country === activeCountry) : pins;
    const matchedArcEndpoints = activeCountry
      ? arcs.flatMap((arc) => {
          const out: Array<{ lat: number; lng: number }> = [];
          if (arc.originCountry === activeCountry) {
            out.push({ lat: arc.originLat, lng: arc.originLng });
          }
          if (arc.destCountry === activeCountry) {
            out.push({ lat: arc.destLat, lng: arc.destLng });
          }
          return out;
        })
      : arcs.flatMap((arc) => [
          { lat: arc.originLat, lng: arc.originLng },
          { lat: arc.destLat, lng: arc.destLng },
        ]);

    // When the overlay is on, fold wishlist pins into the bounds so
    // toggling actually reveals the suggestion — otherwise a pin in a
    // home-country city (e.g. Munich on a Japan trip) sits offscreen
    // and the toggle looks broken. Off-state: bounds collapse back
    // to segments only.
    const matchedWishlistPoints = showWishlist
      ? wishlistPins
          .filter((p) => activeCountry === null || p.country === activeCountry)
          .map((p) => ({ lat: p.lat, lng: p.lng }))
      : [];

    const matched = [...matchedPins, ...matchedArcEndpoints, ...matchedWishlistPoints];
    const fallback = [
      ...pins,
      ...arcs.flatMap((arc) => [
        { lat: arc.originLat, lng: arc.originLng },
        { lat: arc.destLat, lng: arc.destLng },
      ]),
    ];
    const target = matched.length > 0 ? matched : fallback;
    if (target.length === 0) {
      // Empty trip (or post-navigation with all pins removed). Reset
      // to the default world view so we don't keep showing whatever
      // frame the previous render left us on.
      map.fitBounds(DEFAULT_WORLD_BOUNDS, {
        padding: 12,
        animate: firstFitDoneRef.current,
        duration: firstFitDoneRef.current ? 600 : 0,
      });
      firstFitDoneRef.current = true;
      return;
    }

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const point of target) {
      if (point.lng < minLng) minLng = point.lng;
      if (point.lat < minLat) minLat = point.lat;
      if (point.lng > maxLng) maxLng = point.lng;
      if (point.lat > maxLat) maxLat = point.lat;
    }

    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ] satisfies LngLatBoundsLike,
      {
        padding: 60,
        // Don't zoom past city-scale for a single-pin country.
        maxZoom: 8,
        animate: firstFitDoneRef.current,
        duration: firstFitDoneRef.current ? 600 : 0,
      },
    );
    firstFitDoneRef.current = true;
  }, [pins, arcs, activeCountry, mapReady, showWishlist, wishlistPins]);

  return (
    <div className="atlas-rise" style={{ animationDelay: '160ms' }}>
      {showChips && (
        <CountryChipStrip countries={countries} activeCountry={activeCountry} tripId={tripId} />
      )}

      <GeocodeWorkerBanner status={geocodeWorkerStatus} />

      <div className="relative w-full">
        {/*
          The MapLibre container IS the visual card. We can't wrap an
          inner div for chrome because MapLibre injects
          `.maplibregl-map { position: relative }` onto whatever element
          you hand it, silently clobbering Tailwind's `absolute inset-0`
          (same specificity, MapLibre wins the cascade). The inner div
          then has no intrinsic size and collapses to 0px tall. Lesson
          learned in Phase 1 — keep this a single div.
        */}
        <div
          ref={containerRef}
          className="border-foreground/10 bg-card/65 w-full overflow-hidden rounded-2xl border shadow-[0_18px_40px_-28px_rgba(60,40,20,0.25)]"
          // 320px reserved leaves comfortable breathing room below the
          // map (attribution + a clear gap to the viewport edge) even
          // on shorter laptops where the calc clamps the height. The
          // 520px cap matches the visible breathing room on tall
          // monitors so the map never sits flush with the page bottom.
          // svh (not dvh) so the map doesn't resize as the mobile URL
          // bar collapses during scroll.
          style={{ height: 'min(calc(100svh - 320px), 520px)' }}
          aria-label="Trip map"
        />
        {hover && (
          <PinTooltip
            x={hover.x}
            y={hover.y}
            containerWidth={hover.containerWidth}
            containerHeight={hover.containerHeight}
            pin={hover.pin}
          />
        )}
        {showEmptyState && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-muted-foreground bg-card/85 border-foreground/10 max-w-xs rounded-full border px-4 py-2 text-center text-sm shadow-sm backdrop-blur-sm">
              Add a flight to see it on the map.
            </p>
          </div>
        )}
        {ungeocoded.length > 0 && <NotPinnedChip items={ungeocoded} />}
        {wishlistPins.length > 0 && (
          <button
            type="button"
            aria-pressed={showWishlist}
            aria-label={
              showWishlist
                ? `Hide ${wishlistPins.length} wishlist ${wishlistPins.length === 1 ? 'pin' : 'pins'}`
                : `Show ${wishlistPins.length} wishlist ${wishlistPins.length === 1 ? 'pin' : 'pins'}`
            }
            onClick={() => setShowWishlist((v) => !v)}
            className={`absolute top-3 right-3 inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 font-mono text-[10px] tracking-[0.2em] uppercase backdrop-blur-sm transition-colors [@media(hover:hover)]:min-h-9 [@media(hover:hover)]:px-3 [@media(hover:hover)]:py-1.5 ${
              showWishlist
                ? 'border-primary/55 bg-primary/12 text-primary'
                : 'border-foreground/20 bg-card/85 text-foreground/70 hover:text-foreground'
            }`}
          >
            <span
              aria-hidden
              className={
                showWishlist
                  ? 'bg-primary inline-block h-3 w-3 rounded-full'
                  : 'border-foreground/55 inline-block h-3 w-3 rounded-full border border-dashed'
              }
            />
            <span>
              {showWishlist ? 'Showing' : 'Wishlist'} ·{' '}
              {String(wishlistPins.length).padStart(2, '0')}
            </span>
          </button>
        )}
      </div>

      <p className="text-muted-foreground mt-6 text-center font-mono text-[10px] tracking-[0.2em] uppercase">
        Map data © OpenStreetMap contributors · Country shapes © Natural Earth · Geocoding by
        Nominatim
      </p>
    </div>
  );
}

// localStorage-backed toggle for the wishlist overlay. Plain
// useState + a hydration-time effect to load persisted state. The
// effect violates `react-hooks/set-state-in-effect` once — that
// rule is right in spirit but wrong for the SSR-localStorage
// pairing, where setting on the server isn't possible and lazy
// init produces hydration mismatches. The disable is local and the
// reason is in the comment above it. Prior implementation used
// useSyncExternalStore but the toggle wasn't propagating to the
// marker effect in practice; this shape is simpler and obviously
// correct.
function storageKey(tripId: string): string {
  return `atlas:wishlist-overlay:${tripId}`;
}

function useWishlistOverlayState(tripId: string): {
  showWishlist: boolean;
  setShowWishlist: (next: boolean | ((prev: boolean) => boolean)) => void;
} {
  const [showWishlist, setShowWishlistState] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (window.localStorage.getItem(storageKey(tripId)) === 'on') {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration sync from localStorage; lazy initial state would mismatch SSR's default-off render.
        setShowWishlistState(true);
      }
    } catch {
      // Quota / private mode — default-off stays.
    }
  }, [tripId]);

  const setShowWishlist = React.useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setShowWishlistState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(storageKey(tripId), resolved ? 'on' : 'off');
          } catch {
            // Non-fatal — the toggle still works for the session.
          }
        }
        return resolved;
      });
    },
    [tripId],
  );

  return { showWishlist, setShowWishlist };
}
