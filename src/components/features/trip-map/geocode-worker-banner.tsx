import { ServerOff, Settings2 } from 'lucide-react';

import type { GeocodeWorkerStatus } from '@/lib/trip-map/repo';

interface GeocodeWorkerBannerProps {
  status: GeocodeWorkerStatus;
}

// Copy is terse and operator-facing — Atlas is self-hosted, so the
// person reading this is the one who can start the worker or set the
// env var. The env var is named on purpose: it's the fix.
const COPY = {
  'worker-down': {
    Icon: ServerOff,
    text: 'Geocoding worker isn’t running — the pins below stay pending until it’s back.',
  },
  unconfigured: {
    Icon: Settings2,
    text: 'Geocoding isn’t configured — set NOMINATIM_CONTACT_EMAIL to resolve the pins below.',
  },
} as const;

/**
 * A status strip shown above the trip map when geocoding can't resolve
 * the trip's pending pins — either the background worker isn't running
 * or `NOMINATIM_CONTACT_EMAIL` is unset (issue #24). Renders nothing on
 * `'ok'`, so callers can mount it unconditionally. The repo only reports
 * a non-`'ok'` status when there is actually a pending miss to explain.
 */
export function GeocodeWorkerBanner({ status }: GeocodeWorkerBannerProps) {
  if (status === 'ok') return null;
  const { Icon, text } = COPY[status];

  return (
    <div
      // Static, server-rendered informational content (present on first
      // paint, not injected as a live update) — `note`, not the
      // live-region `status`, is the accurate role here.
      role="note"
      className="border-foreground/15 bg-card/70 text-foreground/80 mb-3 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm leading-snug backdrop-blur-sm"
    >
      <Icon aria-hidden className="text-foreground/55 mt-px h-4 w-4 shrink-0" strokeWidth={1.5} />
      <span>{text}</span>
    </div>
  );
}
