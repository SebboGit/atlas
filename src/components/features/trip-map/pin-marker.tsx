import { Bed, Plane, Star, Train, UtensilsCrossed, type LucideIcon } from 'lucide-react';

import type { TripMapPinKind } from '@/lib/trip-map/repo';
import { cn } from '@/lib/utils';

// Per-kind icon. Adding a new pin kind = adding one row here. The
// rest of the rendering pipeline doesn't need to know what icon a
// given kind uses.
const ICON_BY_KIND: Readonly<Record<TripMapPinKind, LucideIcon>> = {
  flight: Plane,
  hotel: Bed,
  activity: Star,
  transit: Train,
  food: UtensilsCrossed,
};

// Food pins get their own fill so a meal-dense trip reads as a
// distinct layer from the activity stars sharing the same map. Every
// other kind keeps the warm-sand primary fill — the icon shape alone
// already separates flight / hotel / transit at a glance. The sage-
// olive `accent` token is the palette's established secondary accent;
// it stays clearly distinct from the terracotta `primary` activity
// pin without introducing an off-palette colour.
const FILL_BY_KIND: Partial<Readonly<Record<TripMapPinKind, string>>> = {
  food: 'bg-accent text-accent-foreground',
};

interface PinMarkerProps {
  kind: TripMapPinKind;
  /**
   * Short string to display above the icon. Currently only rendered
   * for flight pins (the IATA code) — flights skip the hover tooltip
   * because the IATA alone is the headline piece of information; we
   * surface it always-on so the user reads it without hovering. Other
   * pin kinds keep the tooltip and don't paint this label.
   */
  label?: string;
  /** Whether the pin is currently hovered (CSS hover would lag the JS state). */
  hovered?: boolean;
  /** Whether the pin should fade — set when a country chip narrows the view. */
  dimmed?: boolean;
}

/**
 * Single-pin element rendered into a MapLibre Marker container. The
 * Marker positions us at the right lat/lng — our only job is to look
 * like a map pin and pass the hover/dim state through to the icon.
 *
 * Hover/dim are passed as props rather than driven by `:hover` so the
 * map's mousemove handler (not CSS) owns the state — that handler
 * also drives the floating tooltip and feature-state on the arcs, so
 * one source of truth keeps them in sync.
 */
export function PinMarker({ kind, label, hovered, dimmed }: PinMarkerProps) {
  const Icon = ICON_BY_KIND[kind];
  const showLabel = kind === 'flight' && !!label;
  return (
    <div
      className={cn(
        'relative inline-flex flex-col items-center',
        // The dim state fades the whole stack — label and icon
        // together — so a country-narrow view doesn't leave IATA
        // codes shouting from muted pins.
        dimmed && 'opacity-25',
      )}
    >
      {showLabel && (
        <span
          className={cn(
            'pointer-events-none absolute bottom-full mb-1 inline-flex rounded-md border px-1.5 py-0.5 whitespace-nowrap',
            'border-foreground/15 bg-card/85 text-foreground/85 backdrop-blur-sm',
            'font-mono text-[10px] font-medium tracking-[0.16em] uppercase shadow-sm',
          )}
        >
          {label}
        </span>
      )}
      <div
        className={cn(
          'pointer-events-auto inline-flex h-7 w-7 origin-center items-center justify-center rounded-full',
          'border border-white/90',
          // Per-kind fill (food = sage-olive accent); everything else
          // falls back to the warm-sand primary.
          FILL_BY_KIND[kind] ?? 'bg-primary text-primary-foreground',
          'shadow-[0_3px_10px_-2px_rgba(60,40,20,0.45)] transition-[transform,box-shadow] duration-150',
          hovered && 'scale-[1.15] shadow-[0_6px_16px_-3px_rgba(60,40,20,0.6)]',
        )}
      >
        <Icon aria-hidden className="size-3.5" strokeWidth={2.2} />
      </div>
    </div>
  );
}
