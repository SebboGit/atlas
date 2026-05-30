'use client';

import * as React from 'react';
import { Drawer } from 'vaul';

import { cn } from '@/lib/utils';

import type { RailDay } from './timeline-model';
import { TripTimelineRail, type TripTimelineRailProps } from './trip-timeline-rail';

// Snap points for the bottom sheet. "Peek" shows the handle + the
// today/summary header (≈ the bottom 18% of the screen); "open" pulls
// the full timeline up to 82%. The peek height is generous enough to
// surface "Today · N items" without overlapping the map's bottom-left
// "Not pinned" / wishlist chips, which sit just above it.
const SNAP_PEEK = 0.18;
const SNAP_OPEN = 0.82;
const SNAP_POINTS = [SNAP_PEEK, SNAP_OPEN] as const;

// Count of items in the currently-relevant "anchor" day — today for an
// active trip, else the first day — so the peek header reads
// "Today · 4 items" (or "Day 01 · …" for non-active trips).
function anchorSummary(days: RailDay[], isActive: boolean): { label: string; count: number } {
  if (isActive) {
    const today = days.find((d) => d.position === 'today');
    if (today) return { label: 'Today', count: today.items.length };
  }
  const first = days[0];
  if (first)
    return { label: `Day ${String(first.dayNumber).padStart(2, '0')}`, count: first.items.length };
  return { label: 'Timeline', count: 0 };
}

interface TripTimelineSheetProps extends TripTimelineRailProps {
  /** Whether the trip has any days to show — the sheet hides when empty. */
  hasDays: boolean;
}

/**
 * Mobile bottom sheet (vaul) wrapping the shared timeline rail. Pinned
 * to the bottom over a full-screen map:
 *   - peek snap shows a handle + "Today · N items";
 *   - drag up → expands to ~82% revealing the full timeline;
 *   - non-modal (`modal={false}`) so the map underneath stays tappable
 *     and pinch-zoomable while the sheet is peeking;
 *   - never fully dismissible — the lowest snap point keeps it on
 *     screen (the timeline is the primary control, not a transient
 *     overlay).
 *
 * Selecting a segment in the sheet pans the map beneath it; the sheet
 * stays where it is so the user keeps their place in the timeline.
 */
export function TripTimelineSheet({ hasDays, ...railProps }: TripTimelineSheetProps) {
  // Controlled snap so a drag/tap settles on a known point and the
  // header summary reflects it. Starts at the peek floor.
  const [snap, setSnap] = React.useState<number | string | null>(SNAP_PEEK);

  // Mount the Drawer one frame AFTER the component mounts, with
  // `defaultOpen`, so vaul runs its open lifecycle (measure container →
  // compute snap offsets → translate to the active snap). A drawer that
  // mounts already-open skips that lifecycle and gets stuck at the
  // default 100% off-screen transform.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    if (!hasDays) return;
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, [hasDays]);

  if (!hasDays || !mounted) return null;

  const summary = anchorSummary(railProps.days, railProps.isActive);

  return (
    <Drawer.Root
      // Uncontrolled-open so vaul drives the open animation that applies
      // the initial snap transform.
      defaultOpen
      // Non-modal: no scrim, map stays interactive underneath.
      modal={false}
      // Never dismiss — the peek snap is the floor.
      dismissible={false}
      snapPoints={[...SNAP_POINTS]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      // Drag only via the handle area so a flick inside the scrollable
      // timeline scrolls the list rather than collapsing the sheet.
      handleOnly
    >
      <Drawer.Portal>
        {/*
          No Drawer.Overlay — a scrim would block the map. The content
          is a self-contained card anchored to the bottom. lg:hidden so
          the sheet only exists on phone / small tablet; the laptop
          layout uses the inline rail instead.
        */}
        <Drawer.Content
          aria-label="Trip timeline"
          // Full-viewport height: vaul, for a fractional snap point,
          // translates this `bottom-0` content DOWN by
          // `viewportHeight * (1 - snap)` px, so the top `snap` fraction
          // peeks above the bottom edge. That maths only lines up when
          // the content spans the full viewport — a shorter fixed height
          // would translate fully off-screen. The visible region is
          // therefore capped by the snap fractions, not by a max-height.
          style={{ height: '100svh' }}
          className={cn(
            'lg:hidden',
            'border-foreground/12 bg-card/95 fixed inset-x-0 bottom-0 z-30 flex flex-col',
            'rounded-t-2xl border-t shadow-[0_-12px_40px_-24px_rgba(60,40,20,0.4)] backdrop-blur-md',
            'outline-none',
          )}
        >
          {/* Drag handle + peek header. The whole header is the drag
           *  target (handleOnly), so a press here moves the sheet while
           *  the list below scrolls freely. */}
          <div className="shrink-0 cursor-grab px-4 pt-2 pb-3 active:cursor-grabbing">
            <Drawer.Handle className="bg-foreground/20 mx-auto mb-3 h-1.5 w-10 rounded-full" />
            <div className="flex items-baseline gap-2">
              <Drawer.Title className="text-foreground/85 font-mono text-[11px] tracking-[0.2em] uppercase">
                {summary.label}
              </Drawer.Title>
              <span className="text-foreground/40 font-mono text-[10px] tracking-[0.14em]">
                · {summary.count} {summary.count === 1 ? 'item' : 'items'}
              </span>
              <span aria-hidden className="bg-foreground/12 h-px flex-1 self-center" />
              <span className="text-foreground/35 font-mono text-[9px] tracking-[0.18em] uppercase">
                Drag to expand
              </span>
            </div>
          </div>

          {/* Scrollable timeline body. `overscroll-contain` keeps a
           *  scroll-to-top from bubbling into a sheet drag. Bottom
           *  padding clears the iOS home indicator via the safe-area
           *  inset. */}
          <div
            className="min-h-0 flex-1 overflow-y-auto px-3 pt-1"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)' }}
          >
            <TripTimelineRail {...railProps} />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
