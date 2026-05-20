'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

// Watches `window.location.hash` for `#seg-<id>` and, when present,
// scrolls the matching element into view + briefly flashes a ring
// around it. Used by trip-chrome so the hook is mounted once per trip
// page and survives sibling-tab navigation (`/itinerary` → `/flights`).
//
// The element doesn't always exist on the very first tick after a
// pathname change — the new tab's RSC payload streams in and the
// segment list renders a few frames later. The loop polls every 60ms
// for up to ~1.5s and bails the moment it lands a match.
//
// The flash itself is driven by the Web Animations API (`el.animate`)
// rather than a CSS keyframe + attribute toggle. CSS animations don't
// reliably restart when an attribute removed-and-re-added in the same
// tick (the void-offsetWidth reflow trick is browser-dependent), which
// caused the flash to silently stop firing after a few clicks. WAAPI
// returns an Animation handle we can `cancel()` and immediately
// re-`animate()` to play it deterministically every time.

const POLL_INTERVAL_MS = 60;
const MAX_POLL_MS = 1500;
const FLASH_DURATION_MS = 1600;
const HASH_PREFIX = '#seg-';

// One terracotta-tinted box-shadow ring blooms quickly, then fades.
// HSL values match the `--color-primary` token in globals.css.
const FLASH_KEYFRAMES: Keyframe[] = [
  { boxShadow: '0 0 0 0 hsl(18 52% 36% / 0)' },
  { boxShadow: '0 0 0 6px hsl(18 52% 36% / 0.32)', offset: 0.18 },
  { boxShadow: '0 0 0 0 hsl(18 52% 36% / 0)' },
];

const FLASH_OPTIONS: KeyframeAnimationOptions = {
  duration: FLASH_DURATION_MS,
  easing: 'ease-out',
};

// Round the box-shadow ring so it sits flush with the SegmentCard's
// own corners. Stored in dataset so we can restore the previous value
// (typically empty) when the animation finishes.
const RING_RADIUS = '1.25rem';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useSegmentScrollFlash() {
  const pathname = usePathname();

  React.useEffect(() => {
    let cancelled = false;
    let pollTimer: number | undefined;
    let activeAnimation: Animation | null = null;
    let activeElement: HTMLElement | null = null;

    function clearActiveFlash() {
      if (activeAnimation) {
        activeAnimation.cancel();
        activeAnimation = null;
      }
      if (activeElement) {
        activeElement.style.borderRadius = activeElement.dataset.segFlashPrevRadius ?? '';
        delete activeElement.dataset.segFlashPrevRadius;
        activeElement = null;
      }
    }

    function flash(el: HTMLElement) {
      // Cancel anything still in flight — same element re-clicked within
      // the 1.6s window, or different element while the previous was
      // still mid-animation. Restores the prior radius on the previous
      // target so back-to-back flashes don't leak inline styles.
      clearActiveFlash();
      activeElement = el;
      el.dataset.segFlashPrevRadius = el.style.borderRadius;
      el.style.borderRadius = RING_RADIUS;
      if (prefersReducedMotion()) {
        // Skip the box-shadow bloom for users who opted out, but still
        // perform the scroll so the deep-link still lands them on the
        // target. No animation handle to track in this branch.
        return;
      }
      const anim = el.animate(FLASH_KEYFRAMES, FLASH_OPTIONS);
      activeAnimation = anim;
      const onDone = () => {
        if (activeAnimation === anim) clearActiveFlash();
      };
      anim.onfinish = onDone;
      anim.oncancel = onDone;
    }

    function tryScroll(deadline: number) {
      if (cancelled) return;
      const hash = window.location.hash;
      if (!hash.startsWith(HASH_PREFIX)) return;
      const el = document.getElementById(hash.slice(1));
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flash(el);
        return;
      }
      if (Date.now() < deadline) {
        pollTimer = window.setTimeout(() => tryScroll(deadline), POLL_INTERVAL_MS);
      }
    }

    function start() {
      tryScroll(Date.now() + MAX_POLL_MS);
    }

    // Initial mount + pathname change: poll until the element exists.
    start();

    // Hash change without pathname change (e.g. user clicks two results
    // on the same tab in succession) still needs to refire the scroll.
    // Native `hashchange` fires on browser-initiated hash changes; the
    // custom event is emitted by the search palette to cover the
    // router.push case (pushState doesn't fire native hashchange).
    window.addEventListener('hashchange', start);
    window.addEventListener('atlas:seg-target-changed', start);

    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', start);
      window.removeEventListener('atlas:seg-target-changed', start);
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      clearActiveFlash();
    };
  }, [pathname]);
}
