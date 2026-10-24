'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

import { snapTranslateCss, stepSnap } from './sheet-snap';
import type { ResolvedRailDay } from './timeline-model';
import { TripTimelineRail, type TripTimelineRailProps } from './trip-timeline-rail';
import { useMediaQuery } from './use-media-query';
import { useSheetDrag } from './use-sheet-drag';

// Tailwind's `lg` breakpoint in Tailwind's own unit: `--breakpoint-lg`
// is `64rem`, and a rem media query resolves against the browser's
// default font size — so a hard-coded `1024px` would drift from `lg:`
// for anyone who has raised theirs, and the rail and the sheet would
// both vanish in the gap. Keep this in step with `--breakpoint-lg`.
const LG = '64rem';

// The sheet's range: strictly below `lg`, the width at which the inline
// rail takes over. Range syntax rather than `max-width: …px`, so there
// is no sub-pixel gap between the two at fractional viewport widths.
const SHEET_VIEWPORT = `(width < ${LG})`;

// Snap points for the bottom sheet, as fractions of the viewport height
// the sheet shows. "Peek" shows the handle + the today/summary header
// (≈ the bottom 18% of the screen); "open" pulls the full timeline up to
// 82%.
const SNAP_PEEK = 0.18;
const SNAP_OPEN = 0.82;
const SNAP_POINTS = [SNAP_PEEK, SNAP_OPEN] as const;

// The header's height: the least the peek ever shows. On a very short
// viewport (a phone in landscape, 400% zoom) 18% would clip the summary.
const MIN_PEEK_REM = 3.5;

// The peek's on-screen height, as CSS. The map runs on under the sheet
// and its bottom-left chips (Legend, Not pinned) sit at its very bottom,
// so at rest they are covered by the peek. The page reserves this much
// below the map and keeps focus scrolling clear of it (see
// TimelineSheet), so a focused chip is always scrolled out from under the
// sheet rather than behind it.
const PEEK_HEIGHT = `max(${SNAP_PEEK * 100}svh, ${MIN_PEEK_REM}rem)`;

// Breathing room between a focused control and the peek's top edge.
const FOCUS_CLEARANCE = '0.75rem';

// Count of items in the currently-relevant "anchor" day — today for an
// active trip, else the first day — so the peek header reads
// "Today · 4 items" (or "Day 01 · …" for non-active trips).
function anchorSummary(
  days: ResolvedRailDay[],
  isActive: boolean,
): { label: string; count: number } {
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
 * Breakpoint gate for the bottom sheet below.
 *
 * The sheet used to be a vaul Drawer, i.e. a Radix dialog that vaul
 * never made non-modal: wherever it mounted, Radix hid the rest of the
 * page from assistive tech and trapped focus inside it (#150 at desktop
 * width, #159 below `lg`). It is now a plain positioned landmark, so
 * mounting it hides nothing — but it stays a mount gate rather than a
 * `lg:hidden` class, for two reasons: the laptop rail already renders
 * the same `TripTimelineRail`, and a second copy would run its
 * scroll-to-today and its listeners for nothing; and the page would
 * carry two "Trip timeline" landmarks in the DOM, one of them waiting on
 * a class to stay out of the tree.
 */
export function TripTimelineSheet({ hasDays, ...railProps }: TripTimelineSheetProps) {
  const isSheetViewport = useMediaQuery(SHEET_VIEWPORT);

  // Unmounting on the way up (rather than gating inside the sheet) also
  // resets its snap state, so coming back down starts at the peek
  // instead of resuming mid-drag.
  if (!hasDays || !isSheetViewport) return null;

  return <TimelineSheet {...railProps} />;
}

/**
 * Mobile bottom sheet wrapping the shared timeline rail. Pinned to the
 * bottom over a full-screen map:
 *   - peek snap shows the header: a grab bar + "Today · N items";
 *   - drag up (or tap the header) → expands to ~82%, revealing the full
 *     timeline;
 *   - no scrim, and the sheet covers only what it shows, so the map
 *     above it stays tappable and pinch-zoomable;
 *   - never dismissible — the peek snap is the floor (the timeline is
 *     the primary control, not a transient overlay).
 *
 * It is an `<aside>`, not a dialog: the complementary landmark the
 * laptop rail already is, under the same name, so a screen reader finds
 * "Trip timeline" at either width and nothing else on the page is hidden
 * or made inert. Keyboard model:
 *   - the header is a real button (`aria-expanded`, ≥44px tall): Enter /
 *     Space toggle peek ↔ open, Arrow Up / Down step between snaps;
 *   - Tab moves in and out freely — no focus trap;
 *   - keyboard focus that lands in the list at the peek raises the sheet,
 *     so a focused row is never below the screen edge;
 *   - keyboard focus that leaves an open sheet lowers it, so the control
 *     it lands on (the map's chips sit right behind the open sheet) is
 *     never covered;
 *   - Escape lowers an open sheet to the peek and returns focus to the
 *     header; at the peek it does nothing.
 *
 * Rendered in place rather than portalled, so it reads after the map in
 * DOM and tab order. `position: fixed` relies on no ancestor carrying a
 * transform (`atlas-rise` does — keep it off `<main>`).
 *
 * Selecting a segment (a tap in the sheet, or a pin under it) pans the
 * map beneath it and drops the sheet to its peek; a selection made from
 * the keyboard leaves it where it is, so the focused row stays on screen.
 */
function TimelineSheet(railProps: TripTimelineRailProps) {
  const sheetRef = React.useRef<HTMLElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const handleRef = React.useRef<HTMLButtonElement | null>(null);
  const bodyId = React.useId();

  // Starts at the peek floor.
  const [snap, setSnap] = React.useState<number>(SNAP_PEEK);
  const isOpen = snap === SNAP_OPEN;

  // Hold the first frame below the screen edge, then let the snap
  // transition slide the sheet up to its peek — the entrance vaul used
  // to animate. Reduced motion skips the slide (no transition).
  const [entered, setEntered] = React.useState(false);
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // While the sheet exists, focus scrolling (Tab, `focus()`) treats the
  // peek as the bottom of the screen, so a control the browser brings
  // into view lands above the sheet. Set on the root because that is the
  // page's scroller; put back on unmount.
  React.useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = `calc(${PEEK_HEIGHT} + ${FOCUS_CLEARANCE})`;
    return () => {
      root.style.scrollPaddingBottom = previous;
    };
  }, []);

  const drag = useSheetDrag({
    sheetRef,
    bodyRef,
    snaps: SNAP_POINTS,
    snap,
    minPeekRem: MIN_PEEK_REM,
    onSettle: setSnap,
  });

  // Whether the click now running through the list came from the
  // keyboard (Enter / Space on a button dispatches `detail === 0`). Set
  // in the capture phase, read by the selection handler just after.
  const keyboardClickRef = React.useRef(false);
  // A keyboard selection marks its segment here, in the same batch as
  // the parent's selection update, so the adjust-on-prop-change below
  // knows not to drop the sheet under the focused row.
  const [holdSnapFor, setHoldSnapFor] = React.useState<string | null>(null);
  const { onSelectSegment: parentSelect, selectedSegmentId } = railProps;
  const onSelectSegment = React.useCallback(
    (segmentId: string) => {
      if (keyboardClickRef.current && segmentId !== selectedSegmentId) setHoldSnapFor(segmentId);
      parentSelect(segmentId);
    },
    [parentSelect, selectedSegmentId],
  );

  // Selecting a segment (a tap in the sheet, or a pin under it) pans the
  // map to it — drop the sheet back to its peek so the focused pin +
  // tooltip aren't hidden behind it. The Apple/Google-Maps idiom: pick a
  // result, the sheet collapses to reveal it; drag back up for the list.
  // Implemented as "adjust state when a prop changes" (compare to the
  // previous value during render) — React's preferred pattern over a
  // selection-watching effect.
  const [prevSelected, setPrevSelected] = React.useState(selectedSegmentId);
  if (selectedSegmentId !== prevSelected) {
    setPrevSelected(selectedSegmentId);
    if (selectedSegmentId !== null && selectedSegmentId !== holdSnapFor) setSnap(SNAP_PEEK);
    if (holdSnapFor !== null) setHoldSnapFor(null);
  }

  // Keyboard focus arriving in the list while it hangs below the screen
  // edge raises the sheet. `:focus-visible` keeps a tap on a peeking row
  // from doing the same — that tap is a selection, not navigation.
  const onFocus = (e: React.FocusEvent<HTMLElement>) => {
    if (isOpen || !bodyRef.current?.contains(e.target)) return;
    if (e.target.matches(':focus-visible')) setSnap(SNAP_OPEN);
  };

  // Keyboard focus leaving an open sheet lowers it: the map's chips sit
  // right behind the open sheet, so Shift+Tab out of it would otherwise
  // land on a covered control. A null `relatedTarget` (the window lost
  // focus) leaves it alone, and so does a pointer: a tap on the map after
  // a tap in the list moves focus too, and shouldn't fold the sheet away
  // under the finger. `:focus-visible` is only readable once focus has
  // landed, hence the frame.
  const onBlur = (e: React.FocusEvent<HTMLElement>) => {
    const next = e.relatedTarget;
    if (!(next instanceof HTMLElement) || snap === SNAP_PEEK) return;
    if (e.currentTarget.contains(next)) return;
    requestAnimationFrame(() => {
      if (document.activeElement === next && next.matches(':focus-visible')) setSnap(SNAP_PEEK);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || snap === SNAP_PEEK) return;
    setSnap(SNAP_PEEK);
    // The focused row is about to drop below the screen edge — move
    // focus to the header, which stays in view at every snap.
    if (bodyRef.current?.contains(document.activeElement)) {
      handleRef.current?.focus({ preventScroll: true });
    }
  };

  const onHandleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    // Also keeps the arrow from scrolling the page.
    e.preventDefault();
    setSnap(stepSnap(SNAP_POINTS, snap, e.key === 'ArrowUp' ? 1 : -1));
  };

  const summary = anchorSummary(railProps.days, railProps.isActive);
  const restingOffset = entered ? snapTranslateCss(snap, MIN_PEEK_REM) : '100%';
  // Label-only, and true to the state.
  const dragHint = isOpen ? 'Drag to collapse' : 'Drag to expand';
  const hintClass = 'text-foreground/70 font-mono text-[10px] tracking-[0.06em] uppercase';

  return (
    <>
      {/* Room below the map for the peek, so the page can scroll the map's
       *  bottom edge (and its chips) up clear of the sheet. */}
      <div aria-hidden className="shrink-0" style={{ height: PEEK_HEIGHT }} />
      <aside
        ref={sheetRef}
        aria-label="Trip timeline"
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onClickCapture={drag.onClickCapture}
        style={{
          // As tall as the highest snap, anchored to the bottom edge and
          // translated down by its height less what the snap shows, so it
          // never covers more of the map than it shows, and the whole list
          // is reachable when open. A live drag overrides the offset via
          // `--sheet-drag-y` (see useSheetDrag). svh, like the map's own
          // height, so the sheet doesn't jump as the mobile URL bar
          // collapses.
          height: `${SNAP_OPEN * 100}svh`,
          transform: `translateY(var(--sheet-drag-y, ${restingOffset}))`,
        }}
        className={cn(
          'border-foreground/12 bg-card/95 fixed inset-x-0 bottom-0 z-30 flex flex-col',
          'rounded-t-2xl border-t shadow-[0_-12px_40px_-24px_rgba(21,22,26,0.4)] backdrop-blur-md',
          // vaul's snap easing and duration, so the settle feels the same.
          'transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]',
          'data-dragging:transition-none motion-reduce:transition-none',
        )}
      >
        {/* Drag handle + peek header, as one button: tap / Enter / Space
         *  toggle, arrows step, a drag moves the sheet. `touch-none` so the
         *  browser never claims the drag for a page scroll. Its name is the
         *  visible summary. The drag hint is pointer-only advice, so it sits
         *  outside the button (over it, click-through) rather than inside
         *  it unnamed; an invisible copy in the row keeps its room. An
         *  outline, not a ring, for the focus indicator, so it survives
         *  forced colours. */}
        <div className="relative shrink-0">
          <button
            ref={handleRef}
            type="button"
            aria-expanded={isOpen}
            aria-controls={bodyId}
            onClick={() => setSnap(isOpen ? SNAP_PEEK : SNAP_OPEN)}
            onKeyDown={onHandleKeyDown}
            {...drag.handleProps}
            className={cn(
              'block w-full cursor-grab touch-none rounded-t-2xl px-4 pt-2 pb-3 text-left select-none active:cursor-grabbing',
              'focus-visible:outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2',
            )}
          >
            <span
              aria-hidden
              className="bg-foreground/20 mx-auto mb-3 block h-1.5 w-10 rounded-full"
            />
            <span className="flex items-baseline gap-2">
              <span className="text-foreground/85 font-mono text-[11px] tracking-[0.06em] uppercase">
                {summary.label}
              </span>
              <span className="text-foreground/70 font-mono text-[10px] tracking-[0.06em]">
                · {summary.count} {summary.count === 1 ? 'item' : 'items'}
              </span>
              <span aria-hidden className="bg-foreground/12 h-px flex-1 self-center" />
              <span className={cn(hintClass, 'invisible')}>{dragHint}</span>
            </span>
          </button>
          <span
            aria-hidden
            className={cn(hintClass, 'pointer-events-none absolute right-4 bottom-3')}
          >
            {dragHint}
          </span>
        </div>

        {/* Scrollable timeline body. `overscroll-contain` keeps a scroll
         *  that hits either end from chaining into the page; below the
         *  open snap `touch-none` hands every touch drag to the sheet (see
         *  useSheetDrag). Bottom padding clears the iOS home indicator via
         *  the safe-area inset. */}
        <div
          ref={bodyRef}
          id={bodyId}
          onClickCapture={(e) => {
            keyboardClickRef.current = e.detail === 0;
          }}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-1',
            !isOpen && 'touch-none',
          )}
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)' }}
        >
          <TripTimelineRail {...railProps} onSelectSegment={onSelectSegment} />
        </div>
      </aside>
    </>
  );
}
