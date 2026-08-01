'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { ScrollTabStrip } from '@/components/ui/scroll-tab-strip';
import { searchCountries } from '@/lib/countries';
import { cn } from '@/lib/utils';

import { FilterChipLink } from './filter-chip';

export interface WishlistCountryOption {
  /** ISO 3166-1 alpha-2. */
  code: string;
  /** Resolved display name — the page resolves and name-sorts these. */
  name: string;
  /** Items in this country, scoped to the active type filter. */
  count: number;
}

interface WishlistCountryFilterProps {
  /** Current country filter; `null` means "all". */
  activeCountry: string | null;
  /** Countries that have at least one item, name-sorted. */
  countries: readonly WishlistCountryOption[];
}

// Country filter for /wishlist: a search field that is always on screen,
// above a chip row it narrows as you type.
//
// The chips stayed. They are how you see at a glance which countries you
// have saved anything in, and "All countries" being one of them means
// clearing the filter is the same single click it always was — no
// dropdown to open, no field to empty first. The search box is what
// makes the row survive twenty-odd countries: it shortens the track
// rather than replacing it.
//
// Filtering is client state; the filter itself stays in the URL
// (?type=&country=), so the chips are plain links and the page remains a
// server component.
export function WishlistCountryFilter({ activeCountry, countries }: WishlistCountryFilterProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Alias-aware and ranked, so "south korea" finds South Korea and an
  // exact ISO code sorts first.
  const matches = React.useMemo(() => searchCountries(query, countries), [query, countries]);

  // Merge rather than rebuild the querystring, so the type filter (and
  // anything added later) survives a country change.
  function hrefFor(code: string | null): string {
    const params = new URLSearchParams(searchParams.toString());
    if (code) params.set('country', code);
    else params.delete('country');
    const q = params.toString();
    return q ? `${pathname}?${q}` : pathname;
  }

  const trimmed = query.trim();

  return (
    <div className="flex flex-col gap-2">
      <div className="relative max-w-xs">
        <Search
          aria-hidden
          strokeWidth={1.75}
          className="text-foreground/40 pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query !== '') {
              e.preventDefault();
              setQuery('');
            }
          }}
          placeholder="Search countries…"
          aria-label="Search countries"
          aria-describedby="wishlist-country-count"
          autoComplete="off"
          className={cn(
            'border-foreground/15 bg-card/70 text-foreground placeholder:text-muted-foreground/70',
            'h-11 w-full rounded-full border pr-9 pl-8 text-xs',
            'transition-[border-color,box-shadow] duration-200 focus-visible:outline-none',
            'focus-visible:border-primary/55 focus-visible:shadow-[0_0_0_3px_hsl(18_52%_36%/0.16)]',
          )}
        />
        {trimmed !== '' && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Clear country search"
            className="text-foreground/50 [@media(hover:hover)]:hover:text-foreground absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full transition-colors"
          >
            <X aria-hidden className="size-3.5" strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Politely announced so a screen-reader user knows the chip row
       *  below changed as they typed. */}
      <p id="wishlist-country-count" aria-live="polite" className="sr-only">
        {trimmed === ''
          ? `${countries.length} countries`
          : `${matches.length} of ${countries.length} countries match ${trimmed}`}
      </p>

      <ScrollTabStrip ariaLabel="Filter by country" activeKey={activeCountry ?? '__all__'}>
        {/* Always present, never filtered out — clearing the filter must
         *  not depend on what the user has typed. */}
        <FilterChipLink href={hrefFor(null)} active={activeCountry === null}>
          All countries
        </FilterChipLink>
        {matches.map((c) => (
          <FilterChipLink
            key={c.code}
            href={hrefFor(c.code)}
            active={activeCountry === c.code}
            count={c.count}
          >
            {c.name}
          </FilterChipLink>
        ))}
      </ScrollTabStrip>

      {trimmed !== '' && matches.length === 0 && (
        <p className="text-muted-foreground text-xs italic">No countries match.</p>
      )}
    </div>
  );
}
