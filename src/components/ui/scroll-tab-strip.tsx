'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

interface ScrollTabStripProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Accessible name for the strip — required so screen readers can name
   * the `role="group"` region. Pass via this prop rather than `aria-label`
   * so it's not silently overwritten by spread props.
   */
  ariaLabel: string;
  /**
   * Key identifying the currently-active item. When this value changes,
   * the strip scrolls the matching child (`data-active="true"`) into view.
   * Pass the active URL fragment, ISO code, or other stable identifier
   * — anything that changes when the user navigates between items.
   * Omit if no item is "active" or the strip doesn't need auto-scroll.
   */
  activeKey?: string | null;
}

// Horizontal scroll-snap strip used by trip tabs, wishlist filter chips,
// the trip-map country strip, and the trip detail country filter. Below
// sm:, children flow in a single horizontal scroll axis with scroll-snap
// and the scrollbar hidden; safe-area padding keeps the first/last item
// out from under iOS chrome. At sm: and up, the strip falls back to
// wrapping flex with no snap.
//
// Children should set `shrink-0 snap-start` so they participate in the
// snap track without compressing — and `data-active="true"` on the
// active item so the auto-scroll-into-view (driven by activeKey) can
// find it without a ref forest.
export function ScrollTabStrip({
  ariaLabel,
  activeKey,
  children,
  className,
  ...rest
}: ScrollTabStripProps) {
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || activeKey == null) return;
    const active = wrapper.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    // 'nearest' so a tab already in view doesn't yank the strip;
    // 'auto' (no animation) so SSR hydration doesn't pump scroll.
    active.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'auto' });
  }, [activeKey]);

  return (
    <div
      {...rest}
      ref={wrapperRef}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        // Phone: horizontal scroll-snap, hidden scrollbar.
        '-mx-1 flex [scrollbar-width:none] items-center gap-2 overflow-x-auto overflow-y-clip px-1 [&::-webkit-scrollbar]:hidden',
        'snap-x snap-mandatory',
        // Safe-area padding so the first/last item isn't tucked behind
        // iOS chrome (notch / home indicator on a side-rotated phone).
        'scroll-pr-[max(0.25rem,env(safe-area-inset-right))] scroll-pl-[max(0.25rem,env(safe-area-inset-left))]',
        // Laptop: wrap, no snap, normal overflow.
        'sm:snap-none sm:flex-wrap sm:overflow-visible',
        className,
      )}
    >
      {children}
    </div>
  );
}
