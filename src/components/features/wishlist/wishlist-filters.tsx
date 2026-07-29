import Link from 'next/link';

import { ScrollTabStrip } from '@/components/ui/scroll-tab-strip';
import type { WishlistItemType } from '@/lib/wishlist';
import { cn } from '@/lib/utils';

import { WishlistCountryFilter, type WishlistCountryOption } from './wishlist-country-filter';

interface WishlistFiltersProps {
  /** Current type filter; `null` means "all". */
  activeType: WishlistItemType | null;
  /** Current country ISO-2 filter; `null` means "all". */
  activeCountry: string | null;
  /**
   * Countries that have at least one item under the ACTIVE type
   * filter, name-sorted, with their counts. Empty when nothing is
   * saved yet.
   */
  countries: readonly WishlistCountryOption[];
  /** Per-type counts for the chip labels. */
  counts: { all: number; food: number; activity: number };
}

function ChipLink({
  href,
  active,
  children,
  count,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <Link
      href={href}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // items-center (not baseline): with a 44px min-height touch target,
        // baseline alignment parked the label + count at the top of the
        // pill; centring keeps them vertically middled.
        'inline-flex shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors',
        // Tap target on touch per CLAUDE.md.
        'min-h-11',
        // Hover gated to pointer devices (rule 4) so it doesn't stick on tap.
        active
          ? 'border-foreground/45 bg-foreground/8 text-foreground'
          : 'border-foreground/15 text-foreground/70 [@media(hover:hover)]:hover:border-foreground/30 [@media(hover:hover)]:hover:text-foreground',
      )}
    >
      <span>{children}</span>
      {typeof count === 'number' && (
        <span className="text-foreground/60 font-mono text-[10px] tracking-wider">
          {String(count).padStart(2, '0')}
        </span>
      )}
    </Link>
  );
}

// Filter strip for /wishlist. Type chips on top, country typeahead
// below. This file stays a server component: the type chips are plain
// links that re-derive from searchParams, and the country control is a
// self-contained client island that writes the same querystring.
export function WishlistFilters({
  activeType,
  activeCountry,
  countries,
  counts,
}: WishlistFiltersProps) {
  function typeHref(type: WishlistItemType | null): string {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (activeCountry) params.set('country', activeCountry);
    const qs = params.toString();
    return qs ? `/wishlist?${qs}` : '/wishlist';
  }

  return (
    <div className="flex flex-col gap-3">
      <ScrollTabStrip ariaLabel="Filter by type" activeKey={activeType ?? '__all__'}>
        <ChipLink href={typeHref(null)} active={activeType === null} count={counts.all}>
          All
        </ChipLink>
        <ChipLink href={typeHref('food')} active={activeType === 'food'} count={counts.food}>
          Food
        </ChipLink>
        <ChipLink
          href={typeHref('activity')}
          active={activeType === 'activity'}
          count={counts.activity}
        >
          Activities
        </ChipLink>
      </ScrollTabStrip>
      {/* Own row, deliberately not a ScrollTabStrip child: the strip is
       *  a snap-scrolling overflow container, and opening a dropdown
       *  from inside one repositions on every scroll. */}
      {countries.length > 0 && (
        <div className="flex">
          <WishlistCountryFilter activeCountry={activeCountry} countries={countries} />
        </div>
      )}
    </div>
  );
}
