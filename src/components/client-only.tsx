'use client';

import * as React from 'react';

// True only after hydration. getServerSnapshot returns false so the SSR
// output and the first client paint agree, then it flips true on mount —
// no setState-in-effect. Shared by the home countdown's timezone resolve
// and the dialog mount-gates below.
const emptySubscribe = () => () => {};
export function useMounted(): boolean {
  return React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * Renders `children` only after hydration; until then it renders `fallback`
 * (nothing by default).
 *
 * The reason this exists: Radix Dialog triggers claim ids from React's useId
 * counter for their `aria-controls` wiring, and that counter drifts by a
 * fixed offset between the server and client renders of our async RSC tab /
 * list pages. SSR-ing those dialogs therefore produced an `aria-controls`
 * hydration mismatch (#68). Wrapping a card's dialog cluster in `ClientOnly`
 * keeps the dialogs out of SSR entirely — the server and the matching first
 * client paint render only the fallback, and the dialogs attach on mount with
 * ids that exist solely on the client, so there is nothing to mismatch.
 *
 * Only use this for genuinely supplementary, absolutely-positioned, or
 * otherwise layout-neutral UI — deferring content that affects layout would
 * shift the page on mount.
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return useMounted() ? <>{children}</> : <>{fallback}</>;
}
