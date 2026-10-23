'use client';

import * as React from 'react';

import { useMounted } from '@/components/client-only';
import { windowRoute, type RouteLink, type RouteStop } from '@/lib/trips/route';
import { cn } from '@/lib/utils';

const DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function formatDay(ymd: string): string {
  return DAY_FMT.format(new Date(`${ymd}T00:00:00Z`));
}

function localToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const LINK_LINE: Record<RouteLink, string> = {
  flight: 'border-inverse-foreground border-t-2 border-dashed',
  // Transit draws in its segment tone, outlined so it holds on either
  // inverse surface (ink in light mode, near-white in dark).
  transit: 'bg-seg-transit ring-inverse-foreground h-2 rounded-full ring-2',
  transfer: 'border-inverse-muted border-t-2 border-dotted',
};

const LINK_WORD: Record<RouteLink, string> = {
  flight: 'flight',
  transit: 'transit',
  transfer: 'transfer',
};

function describe(stops: RouteStop[]): string {
  return stops
    .map((stop, i) =>
      i === 0
        ? `From ${stop.label}`
        : `${stop.viaLabel ?? LINK_WORD[stop.via ?? 'transfer']} to ${stop.label}`,
    )
    .join(', ');
}

/**
 * The trip as a line diagram — stops left to right, joined by how they were
 * reached: dashed for a flight, a transit-tone bar for a booked leg, dotted
 * for a transfer Atlas holds no booking for. Drawn on the inverse hero, and
 * laptop-only (the caller hides it below `md:`): on a phone the itinerary
 * already reads top to bottom. On an active trip the latest stop reached
 * by today is marked, resolved after mount in the viewer's own day.
 *
 * A long route never clips: `windowRoute` keeps the current stop and the
 * next two, folds the rest into "+N stops" and keeps the last stop. The
 * screen-reader description still names every stop.
 */
export function RouteDiagram({ stops, active }: { stops: RouteStop[]; active: boolean }) {
  const mounted = useMounted();
  const hereIndex = React.useMemo(() => {
    if (!active || !mounted) return -1;
    const today = localToday();
    let index = 0;
    stops.forEach((stop, i) => {
      if (stop.arrivedOn && stop.arrivedOn <= today) index = i;
    });
    return index;
  }, [active, mounted, stops]);
  // Before mount (and on trips not under way) the window starts at the start.
  const items = React.useMemo(() => windowRoute(stops, Math.max(hereIndex, 0)), [stops, hereIndex]);

  return (
    <figure className="min-w-0">
      <figcaption className="text-inverse-muted mb-3 font-mono text-[11px] tracking-[0.06em] uppercase">
        Route
      </figcaption>
      <p className="sr-only">{describe(stops)}.</p>
      <div aria-hidden className="flex items-start">
        {items.map((item, slot) => {
          if (item.kind === 'more') {
            return (
              <div key={`more-${item.side}`} className="flex min-w-14 flex-1 flex-col">
                <span className="text-inverse-muted h-6 px-1 text-center font-mono text-[10px] leading-6 whitespace-nowrap uppercase">
                  +{item.count} {item.count === 1 ? 'stop' : 'stops'}
                </span>
                <span className="flex h-4 items-center px-0.5">
                  <span className="border-inverse-muted w-full border-t-2 border-dotted" />
                </span>
              </div>
            );
          }
          const { stop, index } = item;
          // A fold already stands between this stop and the one drawn before it.
          const linked = slot > 0 && items[slot - 1]?.kind === 'stop' && stop.via;
          return (
            <React.Fragment key={index}>
              {linked && stop.via && (
                <div
                  className={cn(
                    'flex min-w-0 flex-1 flex-col',
                    stop.viaLabel ? 'min-w-12' : 'min-w-5',
                  )}
                >
                  <span className="text-inverse-muted h-6 truncate px-1 text-center font-mono text-[10px] leading-6 uppercase">
                    {stop.viaLabel ?? ''}
                  </span>
                  <span className="flex h-4 items-center px-0.5">
                    <span className={cn('w-full', LINK_LINE[stop.via])} />
                  </span>
                </div>
              )}
              <div className="flex max-w-[6.5rem] min-w-0 shrink-0 flex-col items-center text-center">
                <span className="font-display h-6 max-w-full truncate text-base leading-6">
                  {stop.label}
                </span>
                <span
                  className={cn(
                    'size-4 rounded-full border-[3px]',
                    index === hereIndex
                      ? 'border-inverse-foreground bg-inverse-accent ring-inverse-accent/30 ring-4'
                      : 'border-inverse-foreground bg-inverse',
                  )}
                />
                <span className="text-inverse-muted mt-1.5 font-mono text-[10px] whitespace-nowrap uppercase">
                  {index === hereIndex
                    ? 'You’re here'
                    : stop.arrivedOn
                      ? formatDay(stop.arrivedOn)
                      : ''}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </figure>
  );
}
