'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ChartColumn,
  CornerDownLeft,
  History,
  Luggage,
  Map as MapIcon,
  Sparkles,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
} from '@/components/ui/command';
import { searchAtlas } from '@/lib/search/actions';
import type { SearchResultRow, SearchResults } from '@/lib/search/types';

import { SearchResultsView } from './search-results';
import { useRecentSearches } from './use-recent-searches';
import { useSearchHotkey } from './use-search-hotkey';

// The four top-level destinations the topbar links to. Surfaced in the
// palette's empty state so Cmd+K reaches Map / Stats without a mouse —
// the icons mirror the topbar's so the rows read as the same places.
// Module-scoped so the icon components are stable references (the
// `react-hooks/static-components` rule flags components built in render).
const GO_TO: ReadonlyArray<{ label: string; href: string; Icon: typeof MapIcon }> = [
  { label: 'Trips', href: '/trips', Icon: Luggage },
  { label: 'Wishlist', href: '/wishlist', Icon: Sparkles },
  { label: 'Map', href: '/map', Icon: MapIcon },
  { label: 'Stats', href: '/stats', Icon: ChartColumn },
];

type Ctx = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const SearchPaletteContext = React.createContext<Ctx | null>(null);

export function useSearchPalette(): Ctx {
  const ctx = React.useContext(SearchPaletteContext);
  if (!ctx) {
    throw new Error('useSearchPalette must be used inside <SearchPaletteProvider>');
  }
  return ctx;
}

export function SearchPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const value = React.useMemo<Ctx>(() => ({ open, setOpen }), [open]);
  return <SearchPaletteContext.Provider value={value}>{children}</SearchPaletteContext.Provider>;
}

// Debounce a string by `delay` ms. Resets the timer on every change so
// rapid typing fires exactly one request after the user pauses.
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function SearchPalette() {
  const router = useRouter();
  const { open, setOpen } = useSearchPalette();
  const { items: recent, push: pushRecent } = useRecentSearches();

  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebounced(query, 150);

  useSearchHotkey(React.useCallback(() => setOpen(true), [setOpen]));

  // Reset the input on close so the next open starts blank. Routing the
  // reset through the open-change handler (rather than an effect that
  // watches `open`) keeps it as a direct user-event response — which is
  // what the React Compiler's set-state-in-effect rule wants.
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) setQuery('');
      setOpen(next);
    },
    [setOpen],
  );

  const trimmed = debouncedQuery.trim();
  const enabled = trimmed.length >= 2;

  const { data, isFetching, isError } = useQuery({
    queryKey: ['atlas-search', trimmed],
    queryFn: () => searchAtlas(trimmed),
    enabled,
    // Keep the previous results visible while a new query is in flight
    // so the list doesn't flash empty between keystrokes.
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    // The action throws on auth revocation / network blips. The default
    // retry:3 hangs the palette in "Searching…" with no feedback while
    // the silent retries unwind — fail fast and let the error fallback
    // render instead.
    retry: false,
  });

  const handleSelect = React.useCallback(
    (row: SearchResultRow) => {
      pushRecent(query);
      handleOpenChange(false);
      router.push(row.href);
      // Next's router uses `history.pushState`, which does NOT fire a
      // native `hashchange` event when only the fragment changes. The
      // segment scroll-flash hook listens to `hashchange` to retrigger
      // its scroll on same-pathname navigations — nudge it explicitly
      // so back-to-back segment hits both flash.
      if (typeof window !== 'undefined' && row.href.includes('#seg-')) {
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event('atlas:seg-target-changed'));
        });
      }
    },
    [handleOpenChange, pushRecent, query, router],
  );

  const handleRecentSelect = React.useCallback((value: string) => {
    setQuery(value);
  }, []);

  // Plain route navigation for the "Go to" rows — same close-then-push
  // mechanism the result rows use, minus the recent-search push and the
  // segment-hash nudge (destinations are full pathnames, never fragments).
  const handleGoTo = React.useCallback(
    (href: string) => {
      handleOpenChange(false);
      router.push(href);
    },
    [handleOpenChange, router],
  );

  const showRecent = !enabled && recent.length > 0;
  const totalResults = data ? totalCount(data) : 0;
  const showEmpty = enabled && !isFetching && !isError && data !== undefined && totalResults === 0;
  const liveMessage = buildLiveMessage({ enabled, isFetching, isError, totalResults, trimmed });

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandInput
        placeholder="Search trips, segments, documents…"
        value={query}
        onValueChange={setQuery}
        autoFocus
      />
      <CommandList>
        {/* CommandEmpty is cmdk's empty-state slot — it renders ONLY when
            no items match. The "Go to" rows below count as items, so on
            the empty-query path this never fires; it's left for the
            typed-but-no-matches and error paths. */}
        <CommandEmpty>
          {isError
            ? "Couldn't search right now. Try again in a moment."
            : showEmpty
              ? `No matches for "${trimmed}".`
              : null}
        </CommandEmpty>

        {!enabled ? (
          <CommandGroup heading="Go to">
            {GO_TO.map(({ label, href, Icon }) => (
              <CommandItem key={href} value={`goto:${href}`} onSelect={() => handleGoTo(href)}>
                <Icon className="text-foreground/70 size-4 shrink-0" aria-hidden />
                <span className="text-foreground truncate text-sm">{label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {showRecent ? (
          <CommandGroup heading="Recent">
            {recent.map((value) => (
              <CommandItem
                key={value}
                value={`recent:${value}`}
                onSelect={() => handleRecentSelect(value)}
              >
                <History className="text-foreground/70 size-4 shrink-0" aria-hidden />
                <span className="text-foreground truncate text-sm">{value}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {enabled && isFetching && !data ? <CommandLoading>Searching…</CommandLoading> : null}

        {data && !isError ? (
          <SearchResultsView results={data} query={trimmed} onSelect={handleSelect} />
        ) : null}
      </CommandList>

      {/* Polite live region so screen readers hear result counts /
          loading state / errors without arrowing through the list.
          `aria-atomic` so the whole message is re-read on each update
          rather than only the changed token. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage}
      </div>

      {/* Footer legend — advertises the keyboard contract: the global
          "/" hotkey that opens this palette, ↵ to select the highlighted
          row, esc to close. Mono micro-label register, terse glyph + verb. */}
      <div
        aria-hidden="true"
        className="border-foreground/10 text-muted-foreground flex items-center justify-between gap-3 border-t px-4 py-2 font-mono text-[10px] tracking-[0.18em] uppercase"
      >
        <span className="flex items-center gap-1.5">
          <kbd className="border-foreground/15 text-foreground/70 rounded border px-1 py-px not-italic">
            /
          </kbd>
          search
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <CornerDownLeft className="size-3" /> select
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="border-foreground/15 text-foreground/70 rounded border px-1 py-px not-italic">
              esc
            </kbd>
            close
          </span>
        </span>
      </div>
    </CommandDialog>
  );
}

function totalCount(r: SearchResults): number {
  return r.trips.length + r.segments.length + r.documents.length + r.wishlist.length;
}

function buildLiveMessage(args: {
  enabled: boolean;
  isFetching: boolean;
  isError: boolean;
  totalResults: number;
  trimmed: string;
}): string {
  const { enabled, isFetching, isError, totalResults, trimmed } = args;
  if (!enabled) return '';
  if (isError) return `Search for "${trimmed}" failed.`;
  if (isFetching && totalResults === 0) return `Searching for "${trimmed}".`;
  if (totalResults === 0) return `No matches for "${trimmed}".`;
  return `${totalResults} ${totalResults === 1 ? 'result' : 'results'} for "${trimmed}".`;
}
