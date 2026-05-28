'use client';

import { useQuery } from '@tanstack/react-query';
import { CornerDownLeft, History } from 'lucide-react';
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
            no items match. Recent items count as items, so this fires
            on the typed-but-no-matches path, which is what we want. */}
        <CommandEmpty>
          {!enabled
            ? 'Start typing to search.'
            : isError
              ? "Couldn't search right now. Try again in a moment."
              : showEmpty
                ? `No matches for "${trimmed}".`
                : null}
        </CommandEmpty>

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

      <div
        aria-hidden="true"
        className="border-foreground/10 text-muted-foreground flex items-center justify-between gap-3 border-t px-4 py-2 font-mono text-[10px] tracking-[0.18em] uppercase"
      >
        <span>
          <CornerDownLeft className="-mt-0.5 mr-1 inline size-3" /> open
        </span>
        <span>esc to close</span>
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
