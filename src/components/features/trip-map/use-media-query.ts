'use client';

import * as React from 'react';

/**
 * Live `window.matchMedia(query).matches`.
 *
 * Subscribed through `useSyncExternalStore` so the server snapshot is a
 * stable `false` (no hydration mismatch) and the client re-renders on
 * every crossing of the query without a setState-in-effect — the same
 * shape as the upload dialog's coarse-pointer probe.
 *
 * The `false` server snapshot means anything gated on this hook is
 * absent from SSR and appears on hydration. That is right for
 * supplementary, absolutely-positioned UI; it is wrong for anything that
 * has to be in the first paint or affects layout.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query],
  );
  const getSnapshot = React.useCallback(() => window.matchMedia(query).matches, [query]);

  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
