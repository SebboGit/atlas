'use client';

import { Check, ChevronDown } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { searchCountries } from '@/lib/countries';
import { cn } from '@/lib/utils';

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

// Stable ids rather than useId(). Radix components that mint ids from
// React's useId counter drift between the server and client renders of
// our async RSC list pages (#68), and this control is part of the
// filter row's layout — mount-gating it behind <ClientOnly> would pop
// the primary control in after paint.
const LISTBOX_ID = 'wishlist-country-listbox';
const optionId = (i: number) => `wishlist-country-opt-${i}`;

type Row = { kind: 'all' } | { kind: 'country'; code: string; name: string; count: number };

// Country filter for /wishlist. A chip strip works at four countries
// and falls apart at twenty, so this is a typeahead: type to narrow,
// arrows to move, Enter to commit.
//
// Filtering stays in the URL (?type=&country=) so the page itself
// remains a server component — this is the only client island in the
// filter row, and the type chips next to it stay plain <Link>s that
// re-derive from searchParams on every navigation.
export function WishlistCountryFilter({ activeCountry, countries }: WishlistCountryFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [highlighted, setHighlighted] = React.useState(0);
  const [, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  // Only scroll on keyboard navigation — see the same note in
  // country-select.tsx: scrolling on every highlight change fights the
  // user's own trackpad scroll and makes the list feel stuck.
  const keyboardNavRef = React.useRef(false);

  // Alias-aware and ranked, so "South Korea" finds "Korea, South" and
  // an exact ISO code sorts first. The "All countries" reset is row 0
  // ONLY while the query is empty: once you have typed something, Enter
  // should commit the best match, not clear the filter.
  const rows = React.useMemo<Row[]>(() => {
    const matched = searchCountries(query, countries);
    const out: Row[] = query.trim() === '' ? [{ kind: 'all' }] : [];
    for (const c of matched) {
      out.push({ kind: 'country', code: c.code, name: c.name, count: c.count });
    }
    return out;
  }, [query, countries]);

  const activeName = activeCountry
    ? (countries.find((c) => c.code === activeCountry)?.name ?? activeCountry)
    : null;

  // Merge rather than rebuild the querystring, so the type filter (and
  // anything added later) survives a country change.
  function hrefFor(code: string | null): string {
    const params = new URLSearchParams(searchParams.toString());
    if (code) params.set('country', code);
    else params.delete('country');
    const q = params.toString();
    return q ? `${pathname}?${q}` : pathname;
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery('');
      setHighlighted(0);
    }
  }

  function pick(code: string | null) {
    handleOpenChange(false);
    // `replace`, not `push` — a filter tweak is a view, not a place in
    // history (ADR-0004). `scroll: false` keeps the list where it was.
    startTransition(() => router.replace(hrefFor(code), { scroll: false }));
  }

  // Clamp during render (React's "store info from previous renders"
  // pattern) rather than in an effect, so a shrinking list can't leave
  // aria-activedescendant pointing at a row that no longer exists.
  const maxIndex = Math.max(rows.length - 1, 0);
  if (highlighted > maxIndex) {
    setHighlighted(maxIndex);
  }

  React.useEffect(() => {
    if (!keyboardNavRef.current) return;
    keyboardNavRef.current = false;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  function commit(row: Row | undefined) {
    if (!row) return;
    pick(row.kind === 'all' ? null : row.code);
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      keyboardNavRef.current = true;
      setHighlighted((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      keyboardNavRef.current = true;
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(rows[highlighted]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleOpenChange(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={LISTBOX_ID}
          aria-label="Filter by country"
          className={cn(
            // Chip geometry so it reads as a sibling of the type chips,
            // with the 44px touch floor kept at every width (tablets hit
            // `sm:` and are still touch devices).
            'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors',
            activeCountry
              ? 'border-foreground/45 bg-foreground/8 text-foreground'
              : 'border-foreground/15 text-foreground/70 [@media(hover:hover)]:hover:border-foreground/30 [@media(hover:hover)]:hover:text-foreground',
            'focus-visible:ring-primary/40 focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
          )}
        >
          <span className="max-w-[14rem] truncate">{activeName ?? 'All countries'}</span>
          <ChevronDown className="text-foreground/60 size-3.5 shrink-0" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // Radix autofocuses the content; prevent that and focus the
        // search field directly rather than racing it on a timer.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
        collisionPadding={12}
        // The trigger is chip-sized, so matching its width would give a
        // useless 8rem list. Fixed comfortable width, clamped to the
        // viewport so it can't hang off the edge at 360px.
        className="w-[min(20rem,calc(100vw-2rem))] p-0"
      >
        <div className="border-foreground/10 border-b p-2">
          <Input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Search countries…"
            aria-label="Search countries"
            aria-autocomplete="list"
            aria-controls={LISTBOX_ID}
            aria-activedescendant={rows.length > 0 ? optionId(highlighted) : undefined}
            className="h-9 text-sm"
          />
        </div>
        <div
          ref={listRef}
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Countries"
          className="max-h-[min(360px,var(--radix-popover-content-available-height,50vh))] overflow-y-auto overscroll-contain p-1"
        >
          {rows.length === 0 ? (
            <p className="text-muted-foreground px-3 py-2 text-sm italic">No matches.</p>
          ) : (
            rows.map((row, i) => {
              const selected =
                row.kind === 'all' ? activeCountry === null : activeCountry === row.code;
              return (
                <button
                  key={row.kind === 'all' ? '__all__' : row.code}
                  id={optionId(i)}
                  data-index={i}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => commit(row)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    i === highlighted
                      ? 'bg-foreground/8'
                      : '[@media(hover:hover)]:hover:bg-foreground/5',
                    selected && 'text-primary',
                  )}
                >
                  {row.kind === 'all' ? (
                    <span className="text-foreground/70 italic">All countries</span>
                  ) : (
                    <>
                      <span className="truncate">{row.name}</span>
                      <span className="text-foreground/60 ml-auto font-mono text-[10px] tracking-wider">
                        {String(row.count).padStart(2, '0')}
                      </span>
                    </>
                  )}
                  {selected && (
                    <Check
                      className={cn(
                        'text-primary size-3.5 shrink-0',
                        row.kind === 'all' && 'ml-auto',
                      )}
                      strokeWidth={2}
                      aria-hidden
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
