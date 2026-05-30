'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';

interface GeocodePollerProps {
  /**
   * Count of currently-rendered, geocodable-but-unresolved places.
   * The page computes this server-side (segments / wishlist items
   * whose `buildGeocodeQuery` returns non-null AND whose id isn't in
   * the coords map). When > 0 the poller schedules a server-side
   * re-fetch on a short backoff so the worker-populated cache row
   * surfaces without the user reloading or navigating away.
   */
  pending: number;
}

// Backoff schedule for the refresh attempts. Three attempts cover the
// usual forward-geocode + reverse-geocode worker time budget (~3s)
// with headroom for an overloaded public Nominatim. After that we
// stop — the missing rows are likely null-results that won't fill on
// their own, and we don't want to keep ticking forever.
const REFRESH_DELAYS_MS = [1500, 3500, 7000];

/**
 * Self-revalidating poller for pending geocodes. When a freshly-saved
 * segment lands on the page without coords yet (the worker is still
 * resolving it), the page-level RSC re-renders silently as soon as
 * the cache row appears.
 *
 * Per-page bounded: one poller, one timer at a time. When the missing
 * count drops to zero the attempt counter resets, so a *later* batch
 * of saves gets a fresh budget.
 */
export function GeocodePoller({ pending }: GeocodePollerProps) {
  const router = useRouter();
  const attemptsRef = React.useRef(0);

  React.useEffect(() => {
    if (pending === 0) {
      attemptsRef.current = 0;
      return;
    }
    if (attemptsRef.current >= REFRESH_DELAYS_MS.length) return;
    const delay = REFRESH_DELAYS_MS[attemptsRef.current]!;
    const timer = setTimeout(() => {
      attemptsRef.current += 1;
      router.refresh();
    }, delay);
    return () => clearTimeout(timer);
  }, [pending, router]);

  return null;
}
