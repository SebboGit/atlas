'use client';

import * as React from 'react';

// The home hero's countdown, computed in the VIEWER's timezone. The server
// can't know the client TZ for the first paint, so it renders a neutral
// placeholder and the real value resolves on mount — never an off-by-one
// from a UTC server near midnight. `startYmd` is the trip's start calendar
// day as a `YYYY-MM-DD` token (timezone-independent); "today" is the
// client's own local day.

function daysUntilLocal(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(y!, m! - 1, d!).getTime();
  return Math.round((target - today) / 86_400_000);
}

function compute(status: string, startYmd: string | null): { big: string; cap: string } {
  if (status === 'active') {
    if (startYmd) {
      // Day-of-trip: the start day reads "Day 1".
      const day = Math.max(1, 1 - daysUntilLocal(startYmd));
      return { big: `Day ${day}`, cap: 'into the trip' };
    }
    return { big: 'On trip', cap: 'currently away' };
  }
  if (!startYmd) return { big: '—', cap: 'dates to come' };
  const d = daysUntilLocal(startYmd);
  if (d < 0) return { big: 'Soon', cap: 'departure imminent' };
  if (d === 0) return { big: 'Today', cap: 'you leave today' };
  if (d === 1) return { big: 'Tomorrow', cap: 'until departure' };
  return { big: String(d), cap: 'days until departure' };
}

// True only after hydration — getServerSnapshot returns false so the SSR
// and first client paint agree (the placeholder), then it flips true on
// mount and the timezone-aware value resolves. Avoids a setState-in-effect.
const emptySubscribe = () => () => {};
function useMounted(): boolean {
  return React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function TripCountdown({ status, startYmd }: { status: string; startYmd: string | null }) {
  const mounted = useMounted();
  const value = mounted ? compute(status, startYmd) : null;

  const ready = value !== null;
  const big = value?.big ?? '—';
  const cap = value?.cap ?? '';
  // Reserve the large number's height while resolving so the layout doesn't
  // jump; word values (Day 3 / Tomorrow) step down to a smaller size.
  const large = !ready || /^\d+$/.test(big);

  return (
    <div className="border-foreground/10 flex shrink-0 flex-row items-center gap-4 border-t pt-5 sm:flex-col sm:items-end sm:justify-center sm:border-t-0 sm:border-l sm:pt-0 sm:pl-10 sm:text-right">
      <span
        className={
          'font-display leading-none font-medium ' +
          (ready ? 'text-primary ' : 'text-primary/20 ') +
          (large ? 'text-5xl sm:text-6xl' : 'text-3xl sm:text-4xl')
        }
      >
        {big}
      </span>
      <span className="text-foreground/60 max-w-[8rem] font-mono text-xs leading-snug font-medium tracking-[0.16em] uppercase">
        {cap}
      </span>
    </div>
  );
}
