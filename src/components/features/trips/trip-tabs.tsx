'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';

// Roman numerals reinforce the table-of-contents feel — these are the
// chapters of a trip. Order matters; Itinerary is the default landing.
// Tabs are the per-type lists for a trip. Map is intentionally NOT a
// tab — it's a focused perspective switch reached via the "View map"
// affordance in the trip header. Putting it here would force the map
// to share the standard tab chrome (filter bar, header actions,
// padded layout) which fights for the vertical space the map wants.
const TABS = [
  { slug: 'itinerary', label: 'Itinerary', numeral: 'i' },
  { slug: 'flights', label: 'Flights', numeral: 'ii' },
  { slug: 'hotels', label: 'Hotels', numeral: 'iii' },
  { slug: 'activities', label: 'Activities', numeral: 'iv' },
  { slug: 'food', label: 'Food', numeral: 'v' },
  { slug: 'documents', label: 'Documents', numeral: 'vi' },
] as const;

export function TripTabs({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  // Preserve the country filter across tab switches (ADR-0004).
  const country = sp.get('country');
  const activeSlug = TABS.find((t) => pathname?.startsWith(`/trips/${tripId}/${t.slug}`))?.slug;

  return (
    // Six fixed chapters, so the strip wraps onto as many rows as it needs
    // rather than scrolling horizontally — every tab stays visible at a
    // glance. (The shared ScrollTabStrip is kept for the country/wishlist
    // chip rows, where the item count is open-ended and scroll earns its
    // keep.) Tighter letter-spacing on phone lets the labels share a row
    // before they wrap; the laptop spacing matches the rest of the chrome.
    <nav
      aria-label="Trip sections"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-1"
    >
      {TABS.map((tab) => {
        const href = `/trips/${tripId}/${tab.slug}${country ? `?country=${encodeURIComponent(country)}` : ''}`;
        const isActive = activeSlug === tab.slug;
        return (
          <Link
            key={tab.slug}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative shrink-0 px-1 py-2 font-mono text-xs tracking-[0.16em] uppercase transition-colors sm:px-3 sm:tracking-[0.28em]',
              // Tap target on touch per CLAUDE.md responsive rules.
              'inline-flex min-h-11 items-center',
              isActive ? 'text-foreground' : 'text-foreground/45 hover:text-foreground/85',
            )}
          >
            <span className="text-foreground/40 mr-1.5 normal-case">{tab.numeral}.</span>
            {tab.label}
            {isActive && (
              <span
                aria-hidden
                className="bg-primary absolute right-1 -bottom-px left-1 h-px sm:right-3 sm:left-3"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
