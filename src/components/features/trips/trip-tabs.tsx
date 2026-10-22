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
  { slug: 'itinerary', label: 'Itinerary' },
  { slug: 'flights', label: 'Flights' },
  { slug: 'hotels', label: 'Hotels' },
  { slug: 'activities', label: 'Activities' },
  { slug: 'food', label: 'Food' },
  { slug: 'documents', label: 'Documents' },
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
    // keep.) The active chapter is the ink pill, as in the topbar.
    <nav aria-label="Trip sections" className="flex flex-wrap items-center gap-1.5">
      {TABS.map((tab) => {
        const href = `/trips/${tripId}/${tab.slug}${country ? `?country=${encodeURIComponent(country)}` : ''}`;
        const isActive = activeSlug === tab.slug;
        return (
          <Link
            key={tab.slug}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-[15px] font-semibold transition-colors [@media(hover:hover)]:min-h-10',
              isActive
                ? 'bg-foreground text-background'
                : 'bg-card text-muted-foreground border-border [@media(hover:hover)]:hover:text-foreground border',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
