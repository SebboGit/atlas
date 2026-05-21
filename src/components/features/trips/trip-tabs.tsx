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

  return (
    <nav
      aria-label="Trip sections"
      // overflow-y-clip is deliberate: `overflow-x: auto` would
      // silently coerce overflow-y to `auto` per CSS spec, and the
      // active-tab indicator's `-bottom-px` offset is enough to
      // trigger a phantom vertical scrollbar. `clip` lets the
      // indicator bleed visually without producing a scroll axis.
      className="-mx-1 flex [scrollbar-width:none] items-center gap-1 overflow-x-auto overflow-y-clip px-1 [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const href = `/trips/${tripId}/${tab.slug}${country ? `?country=${encodeURIComponent(country)}` : ''}`;
        const isActive = pathname?.startsWith(`/trips/${tripId}/${tab.slug}`);
        return (
          <Link
            key={tab.slug}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative shrink-0 px-3 py-2 font-mono text-xs tracking-[0.28em] uppercase transition-colors',
              isActive ? 'text-foreground' : 'text-foreground/45 hover:text-foreground/85',
            )}
          >
            <span className="text-foreground/40 mr-1.5 normal-case">{tab.numeral}.</span>
            {tab.label}
            {isActive && (
              <span aria-hidden className="bg-primary absolute right-3 -bottom-px left-3 h-px" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
