'use client';

import { Bed, ChevronUp, Plane, Star, Train, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TripMapArc, TripMapPinKind } from '@/lib/trip-map/repo';
import { cn } from '@/lib/utils';

import { legendRows, type RouteStyle } from './legend-rows';

// Mirrors pin-marker.tsx's ICON_BY_KIND and FILL_BY_KIND so the legend
// swatch reads as the same mark the user sees on the map. Kept local
// (not imported from the marker) because the marker's exports are the
// rendered element, not its lookup tables — duplicating two tiny maps
// is cheaper than widening that module's surface.
const ICON_BY_KIND: Readonly<Record<TripMapPinKind, LucideIcon>> = {
  flight: Plane,
  hotel: Bed,
  activity: Star,
  transit: Train,
  food: UtensilsCrossed,
};

interface PinLegendChipProps {
  /** All pin kinds present on this trip — the legend lists only these. */
  kinds: ReadonlySet<TripMapPinKind>;
  /**
   * Route kinds drawn on this trip. A present kind adds its line swatch —
   * dashed beside Flight, solid beside Transit (ADR-0019).
   */
  routeKinds?: ReadonlySet<TripMapArc['kind']>;
}

const NO_ROUTES: ReadonlySet<TripMapArc['kind']> = new Set();

/**
 * Bottom-left disclosure decoding the trip-map's pin kinds. The map can
 * carry up to five marker types and the icons alone are undecodable on
 * a phone where there's no hover tooltip — this is the key.
 *
 * Mirrors NotPinnedChip's popover treatment (same chip geometry, same
 * `side="top"` panel, same mono header) so the two bottom-left controls
 * read as one family. Positioned a row higher than NotPinnedChip via the
 * caller's layout so both can coexist without overlap.
 *
 * Lists ONLY the kinds actually on the trip — a flights-only itinerary
 * shows one row, not five greyed placeholders.
 */
export function PinLegendChip({ kinds, routeKinds = NO_ROUTES }: PinLegendChipProps) {
  const [open, setOpen] = React.useState(false);

  // Stable, kind-ordered list of just the present kinds.
  const rows = legendRows(kinds, routeKinds);
  const present = rows.map((row) => row.kind);
  if (present.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          aria-label="Map legend"
          className="border-foreground/20 bg-card/85 text-foreground/75 hover:border-foreground/30 hover:text-foreground inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 font-mono text-[10px] tracking-[0.2em] uppercase backdrop-blur-sm transition-colors [@media(hover:hover)]:min-h-9 [@media(hover:hover)]:px-3 [@media(hover:hover)]:py-1.5"
        >
          {/* A miniature stack of the present swatches doubles as the icon —
              the chip already previews the legend before it's opened. */}
          <span aria-hidden className="flex items-center -space-x-1">
            {present.slice(0, 3).map((kind) => (
              <LegendSwatch key={kind} kind={kind} size="xs" />
            ))}
          </span>
          <span>Legend · {String(present.length).padStart(2, '0')}</span>
          <ChevronUp
            aria-hidden
            className={cn(
              'text-primary h-3.5 w-3.5 transition-transform duration-150',
              open && 'rotate-180',
            )}
            strokeWidth={2.25}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-[min(15rem,calc(100vw-1.5rem))] p-0"
      >
        <div className="border-foreground/10 border-b px-4 pt-3 pb-2">
          <h3 className="text-foreground/70 font-mono text-[10px] tracking-[0.28em] uppercase">
            Legend
          </h3>
        </div>
        <ul role="list" className="divide-foreground/8 divide-y">
          {rows.map(({ kind, label, route }) => (
            <li key={kind} className="flex items-center gap-3 px-4 py-2.5">
              <LegendSwatch kind={kind} size="md" />
              <span className="text-foreground/90 text-sm font-medium">{label}</span>
              {route && <RouteSwatch style={route} />}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// The pin glyph rendered at chip/legend scale. Echoes PinMarker's
// fill discipline: food rides the sage `accent`, every other kind the
// terracotta `primary`.
function LegendSwatch({ kind, size }: { kind: TripMapPinKind; size: 'xs' | 'md' }) {
  const Icon = ICON_BY_KIND[kind];
  const isFood = kind === 'food';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-white/90 shadow-sm',
        isFood ? 'bg-accent text-accent-foreground' : 'bg-primary text-primary-foreground',
        size === 'xs' ? 'h-4 w-4' : 'h-6 w-6',
      )}
    >
      <Icon aria-hidden className={size === 'xs' ? 'size-2.5' : 'size-3.5'} strokeWidth={2.2} />
    </span>
  );
}

// A short sample of the line a kind draws on the map, echoing the layer
// paint in arc-layers.ts: the flight's dashed thread, the transit line's
// ivory casing under a solid core. Decorative — the row label names it.
function RouteSwatch({ style }: { style: RouteStyle }) {
  return (
    <svg aria-hidden viewBox="0 0 24 8" className="text-primary ml-auto h-2 w-6 shrink-0">
      {style === 'dashed' ? (
        <line
          x1="1"
          y1="4"
          x2="23"
          y2="4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
      ) : (
        <>
          <line
            x1="2"
            y1="4"
            x2="22"
            y2="4"
            stroke="rgba(255, 253, 248, 0.9)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <line
            x1="2"
            y1="4"
            x2="22"
            y2="4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
