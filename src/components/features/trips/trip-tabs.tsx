'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { ScrollTabStrip } from '@/components/ui/scroll-tab-strip';
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
    <ScrollTabStrip ariaLabel="Trip sections" activeKey={activeSlug ?? null}>
      {TABS.map((tab) => {
        const href = `/trips/${tripId}/${tab.slug}${country ? `?country=${encodeURIComponent(country)}` : ''}`;
        const isActive = activeSlug === tab.slug;
        return (
          <Link
            key={tab.slug}
            href={href}
            data-active={isActive || undefined}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative shrink-0 snap-start px-3 py-2 font-mono text-xs tracking-[0.28em] uppercase transition-colors',
              // Tap target on touch per CLAUDE.md responsive rules.
              'inline-flex min-h-11 items-center',
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
    </ScrollTabStrip>
  );
}
