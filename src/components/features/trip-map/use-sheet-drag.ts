'use client';

import * as React from 'react';

import {
  clampVisible,
  DRAG_SLOP,
  effectiveSnaps,
  releaseVelocity,
  settleSnap,
  type TrackSample,
} from './sheet-snap';

// A click this soon after a drag is the tail of that drag, not a tap,
// and is swallowed before it reaches the handle or a rail row.
const CLICK_AFTER_DRAG_MS = 400;

// Enough samples to span the velocity window at 120 Hz.
const MAX_TRACK = 32;

interface Gesture {
  /** The handle's pointer, or null for a touch that started in the list. */
  pointerId: number | null;
  startY: number;
  startVisible: number;
  /** px per visible fraction — the viewport height the snaps are written against. */
  viewportPx: number;
  /** The snaps as they apply on this viewport (see `effectiveSnaps`). */
  snaps: number[];
  track: TrackSample[];
  /** Past {@link DRAG_SLOP}: the sheet follows the finger. */
  dragging: boolean;
  visible: number;
}

interface ListTouch {
  y: number;
  t: number;
  mode: 'pending' | 'sheet' | 'scroll';
}

interface UseSheetDragOptions {
  /** The sheet. Must be `highest snap × 100svh` tall and bottom-anchored. */
  sheetRef: React.RefObject<HTMLElement | null>;
  /** The scrollable list inside it. */
  bodyRef: React.RefObject<HTMLElement | null>;
  snaps: readonly number[];
  snap: number;
  /** The least the lowest snap shows, in rem — the header's height. */
  minPeekRem: number;
  /** Called once per released drag with the snap it settles on. */
  onSettle: (snap: number) => void;
}

/**
 * The bottom sheet's drag gesture, without a library.
 *
 * While a drag is live the sheet's position is written straight to a
 * `--sheet-drag-y` custom property (and `data-dragging` turns the snap
 * transition off), so a move costs no React render of the rail inside.
 * Release removes both, the sheet's own transform falls back to its
 * snap offset, and the transition carries it there from wherever the
 * finger let go.
 *
 * One gesture at a time: a second finger, or the other entry point,
 * while one is live is ignored, and a gesture that loses its pointer
 * without a release (capture lost, cancelled) settles like a slow
 * release, so the sheet is never left frozen mid-drag.
 *
 * Two entry points:
 *   - the handle, with pointer events. It is `touch-action: none`, so
 *     the browser never claims the gesture, and the pointer is captured
 *     so a mouse drag keeps tracking off the handle;
 *   - the list, with touch events. Fully raised, the list scrolls as
 *     normal and only a pull down from its very top moves the sheet; at
 *     a lower snap every vertical drag moves the sheet. Touch events,
 *     not pointer events, because only a non-passive `touchmove` can
 *     veto the browser's own scroll once it has seen the finger move —
 *     a pointer stream is already cancelled by then. A mouse in the
 *     list scrolls with the wheel and drags nothing.
 */
export function useSheetDrag({
  sheetRef,
  bodyRef,
  snaps,
  snap,
  minPeekRem,
  onSettle,
}: UseSheetDragOptions) {
  const gestureRef = React.useRef<Gesture | null>(null);
  const listTouchRef = React.useRef<ListTouch | null>(null);
  const lastDragEndRef = React.useRef(-Infinity);
  const highest = Math.max(...snaps);

  // Returns whether a gesture started — false while another is live.
  const begin = React.useCallback(
    (y: number, t: number, pointerId: number | null): boolean => {
      const sheet = sheetRef.current;
      if (!sheet || gestureRef.current) return false;
      // offsetHeight ignores the transform, so this is the sheet's full
      // height whatever snap it is at.
      const viewportPx = sheet.offsetHeight / highest;
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const effective = effectiveSnaps(snaps, viewportPx, minPeekRem * rootPx);
      const startVisible = effective[snaps.indexOf(snap)] ?? snap;
      gestureRef.current = {
        pointerId,
        startY: y,
        startVisible,
        viewportPx,
        snaps: effective,
        track: [{ y, t }],
        dragging: false,
        visible: startVisible,
      };
      return true;
    },
    [sheetRef, snaps, snap, highest, minPeekRem],
  );

  const move = React.useCallback(
    (owner: number | null, y: number, t: number) => {
      const g = gestureRef.current;
      const sheet = sheetRef.current;
      if (!g || g.pointerId !== owner || !sheet) return;
      g.track.push({ y, t });
      if (g.track.length > MAX_TRACK) g.track.shift();
      if (!g.dragging) {
        if (Math.abs(y - g.startY) < DRAG_SLOP) return;
        g.dragging = true;
        sheet.setAttribute('data-dragging', '');
      }
      g.visible = clampVisible(g.startVisible + (g.startY - y) / g.viewportPx, g.snaps);
      sheet.style.setProperty('--sheet-drag-y', `${(highest - g.visible) * g.viewportPx}px`);
    },
    [sheetRef, highest],
  );

  const end = React.useCallback(
    (owner: number | null, t: number, cancelled: boolean) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== owner) return;
      gestureRef.current = null;
      // Cleared before anything else, so no exit below can leave the
      // sheet pinned to a stale drag position. Both land in the same task
      // as the snap update, so the browser sees one style change and
      // transitions from the dragged position.
      const sheet = sheetRef.current;
      sheet?.removeAttribute('data-dragging');
      sheet?.style.removeProperty('--sheet-drag-y');
      if (!g.dragging) return;
      lastDragEndRef.current = performance.now();
      const settled = settleSnap(g.snaps, g.visible, cancelled ? 0 : releaseVelocity(g.track, t));
      onSettle(snaps[g.snaps.indexOf(settled)] ?? settled);
    },
    [sheetRef, snaps, onSettle],
  );

  // The list's touch handover. Native listeners: React's touch handlers
  // are passive, so they could not cancel the scroll.
  React.useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      // A second finger is a pinch or a scroll, never a sheet drag.
      if (e.touches.length !== 1 || !touch) {
        if (listTouchRef.current?.mode === 'sheet') end(null, e.timeStamp, true);
        listTouchRef.current = null;
        return;
      }
      listTouchRef.current = { y: touch.clientY, t: e.timeStamp, mode: 'pending' };
    };

    const onTouchMove = (e: TouchEvent) => {
      const lt = listTouchRef.current;
      const touch = e.touches[0];
      if (!lt || !touch) return;
      if (lt.mode === 'pending') {
        const dy = touch.clientY - lt.y;
        let takeOver: boolean;
        if (snap < highest) {
          // Lowered, the list is `touch-none` — nothing to race, so a tap
          // with a little jitter stays a tap until the slop is passed.
          if (Math.abs(dy) < DRAG_SLOP) return;
          takeOver = true;
        } else {
          // Raised, decide on the very first move: a pull down from the
          // top is cancelled straight away, before WebKit can start a
          // rubber-band and stop letting later moves be cancelled.
          if (dy === 0) return;
          takeOver = body.scrollTop <= 0 && dy > 0;
        }
        lt.mode = takeOver && begin(lt.y, lt.t, null) ? 'sheet' : 'scroll';
      }
      if (lt.mode !== 'sheet') return;
      if (e.cancelable) e.preventDefault();
      move(null, touch.clientY, e.timeStamp);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (listTouchRef.current?.mode === 'sheet') end(null, e.timeStamp, e.type === 'touchcancel');
      listTouchRef.current = null;
    };

    body.addEventListener('touchstart', onTouchStart, { passive: true });
    body.addEventListener('touchmove', onTouchMove, { passive: false });
    body.addEventListener('touchend', onTouchEnd);
    body.addEventListener('touchcancel', onTouchEnd);
    return () => {
      body.removeEventListener('touchstart', onTouchStart);
      body.removeEventListener('touchmove', onTouchMove);
      body.removeEventListener('touchend', onTouchEnd);
      body.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [bodyRef, snap, highest, begin, move, end]);

  const handleProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!begin(e.clientY, e.timeStamp, e.pointerId)) return;
      // Captured on the handle itself, so a plain tap's click still
      // lands on it and toggles.
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) =>
      move(e.pointerId, e.clientY, e.timeStamp),
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => end(e.pointerId, e.timeStamp, false),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => end(e.pointerId, e.timeStamp, true),
    // Fires after `pointerup` too, by which point the gesture is gone and
    // this is a no-op; on its own it means the pointer was taken away.
    onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) =>
      end(e.pointerId, e.timeStamp, true),
  };

  const onClickCapture = React.useCallback((e: React.MouseEvent) => {
    if (performance.now() - lastDragEndRef.current < CLICK_AFTER_DRAG_MS) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return { handleProps, onClickCapture };
}
