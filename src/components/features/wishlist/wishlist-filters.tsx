import Link from 'next/link';

import { ScrollTabStrip } from '@/components/ui/scroll-tab-strip';
import { countryName } from '@/lib/countries';
import type { WishlistItemType } from '@/lib/wishlist';
import { cn } from '@/lib/utils';

interface WishlistFiltersProps {
  /** Current type filter; `null` means "all". */
  activeType: WishlistItemType | null;
  /** Current country ISO-2 filter; `null` means "all". */
  activeCountry: string | null;
  /** Country codes that have at least one item, sorted. */
  countriesWithItems: readonly string[];
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

// Filter strip for /wishlist. Type chips on top, country chips below.
// Both navigate via querystring so the server component re-renders
// with the new filters — no client state.
export function WishlistFilters({
  activeType,
  activeCountry,
  countriesWithItems,
  counts,
}: WishlistFiltersProps) {
  // Country chips are URL-driven too. Type stays on the link when
  // present so switching country doesn't reset type.
  function countryHref(code: string | null): string {
    const params = new URLSearchParams();
    if (activeType) params.set('type', activeType);
    if (code) params.set('country', code);
    const qs = params.toString();
    return qs ? `/wishlist?${qs}` : '/wishlist';
  }
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
      {countriesWithItems.length > 0 && (
        <ScrollTabStrip ariaLabel="Filter by country" activeKey={activeCountry ?? '__all__'}>
          <ChipLink href={countryHref(null)} active={activeCountry === null}>
            All countries
          </ChipLink>
          {countriesWithItems.map((code) => (
            <ChipLink key={code} href={countryHref(code)} active={activeCountry === code}>
              {countryName(code) ?? code}
            </ChipLink>
          ))}
        </ScrollTabStrip>
      )}
    </div>
  );
}
