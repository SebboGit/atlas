import { ScrollTabStrip } from '@/components/ui/scroll-tab-strip';
import type { WishlistItemType } from '@/lib/wishlist';

import { FilterChipLink } from './filter-chip';
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

// Filter strip for /wishlist. Type chips on top, then the country row —
// a search field over its own chip strip. This file stays a server
// component: the type chips are plain links that re-derive from
// searchParams, and only the country row (which holds the search query)
// is a client island.
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
        <FilterChipLink href={typeHref(null)} active={activeType === null} count={counts.all}>
          All
        </FilterChipLink>
        <FilterChipLink href={typeHref('food')} active={activeType === 'food'} count={counts.food}>
          Food
        </FilterChipLink>
        <FilterChipLink
          href={typeHref('activity')}
          active={activeType === 'activity'}
          count={counts.activity}
        >
          Activities
        </FilterChipLink>
      </ScrollTabStrip>
      {countries.length > 0 && (
        <WishlistCountryFilter activeCountry={activeCountry} countries={countries} />
      )}
    </div>
  );
}
