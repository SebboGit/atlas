'use client';

import { Search } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';

import { useSearchPalette } from './search-palette';

// Render the mac vs. non-mac kbd hint only after mount. `navigator` is
// not available during SSR, so committing it to the first paint would
// produce a hydration mismatch on Linux/Windows clients. useSyncExternalStore
// gives us a clean server-snapshot path that React's set-state-in-effect
// lint rule recognises as intentional.
const NOOP_SUBSCRIBE = () => () => {};
function getIsMacClient(): boolean {
  return /Mac|iPod|iPhone|iPad/.test(window.navigator.userAgent);
}
function useIsMac(): boolean | null {
  return React.useSyncExternalStore<boolean | null>(NOOP_SUBSCRIBE, getIsMacClient, () => null);
}

export function SearchTrigger() {
  const { setOpen } = useSearchPalette();
  const isMac = useIsMac();
  const modKey = isMac === null ? null : isMac ? '⌘' : 'Ctrl';

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => setOpen(true)}
      className="text-foreground/70 hover:text-foreground min-h-11 min-w-11 gap-2 sm:min-h-9 sm:min-w-0"
      aria-label="Search Atlas"
    >
      <Search className="size-4" aria-hidden />
      <span className="hidden sm:inline">Search</span>
      {/* aria-hidden on the kbd hint: the parent button's aria-label
          already names the action, and screen readers vary on how they
          announce the ⌘ glyph ("clover", "command", silence). Visual
          shortcut, no audible noise. */}
      {modKey ? (
        <kbd
          aria-hidden="true"
          className="border-foreground/15 text-muted-foreground hidden items-center gap-0.5 rounded-md border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] sm:inline-flex"
        >
          {modKey}
          <span>K</span>
        </kbd>
      ) : null}
    </Button>
  );
}
