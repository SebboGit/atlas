'use client';

import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Shown above the trip map while the browser is offline. The street/terrain
 * basemap streams through `/api/tiles` (deliberately not cached for offline —
 * the tiles are too large; see ADR-0017), so offline it can't load. The
 * flight arcs, country shapes, and pins below still render, so this explains
 * the bare map rather than leaving it mysteriously blank.
 *
 * Connectivity isn't knowable at SSR, so this starts in the online state —
 * server and first client render agree (both render nothing) — then reflects
 * `navigator.onLine` after mount. No hydration mismatch.
 */
export function MapOfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      // A live update (connectivity changes after mount), so the polite
      // live-region `status` role is right here — unlike the static,
      // server-rendered GeocodeWorkerBanner, which uses `note`.
      role="status"
      className="border-foreground/15 bg-card/70 text-foreground/80 mb-3 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm leading-snug backdrop-blur-sm"
    >
      <WifiOff
        aria-hidden
        className="text-foreground/55 mt-px h-4 w-4 shrink-0"
        strokeWidth={1.5}
      />
      <span>Offline — map background unavailable. Pins and routes still shown.</span>
    </div>
  );
}
