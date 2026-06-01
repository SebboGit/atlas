'use client';

import { ChevronUp } from 'lucide-react';
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { tallyContinents } from './iso-continent';

interface VisitedPanelProps {
  /** Visited ISO 3166-1 alpha-2 codes — the only client-side input. */
  codes: string[];
}

/**
 * Bottom-left overlay for the world choropleth — without it the map is a
 * lone shape and one number up in the header. Anchors a terracotta
 * swatch (matching the map's visited fill) to the headline count, and
 * discloses a per-continent breakdown built entirely client-side from
 * the visited ISO codes (no server query — see iso-continent.ts).
 *
 * Reuses the NotPinnedChip / wishlist-toggle card treatment so the three
 * map overlays read as one family: warm card, hairline border, mono
 * micro-label, `side="top"` disclosure panel.
 */
export function VisitedPanel({ codes }: VisitedPanelProps) {
  const [open, setOpen] = React.useState(false);

  const total = codes.length;
  const tally = React.useMemo(() => tallyContinents(codes), [codes]);
  // The tally only earns the disclosure when ISO codes resolved to 2+
  // continents — a single-continent traveller gets the static chip with
  // no chevron (nothing to expand to).
  const hasBreakdown = tally.length >= 2;

  const chip = (
    <span className="inline-flex items-center gap-2.5">
      {/* Terracotta swatch — the same fill the visited countries carry on
          the map, so the legend is self-evident. */}
      <span
        aria-hidden
        className="bg-primary inline-block h-3 w-3 shrink-0 rounded-[3px] shadow-sm"
      />
      <span className="text-foreground/80 font-mono text-[10px] tracking-[0.2em] uppercase">
        Visited
      </span>
      <span className="font-display text-foreground text-base leading-none font-semibold tabular-nums">
        {total}
      </span>
    </span>
  );

  const chipClasses =
    'border-foreground/20 bg-card/85 absolute bottom-3 left-3 inline-flex min-h-11 items-center gap-2.5 rounded-full border px-4 py-2 backdrop-blur-sm [@media(hover:hover)]:min-h-9 [@media(hover:hover)]:px-3.5 [@media(hover:hover)]:py-1.5';

  // No breakdown → a static, non-interactive plate. No chevron, no
  // popover machinery — just the swatch + count.
  if (!hasBreakdown) {
    return (
      <div aria-label={`${total} countries visited`} className={chipClasses}>
        {chip}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${total} countries visited across ${tally.length} continents`}
          className={cn(
            chipClasses,
            'text-foreground/75 hover:border-foreground/30 hover:text-foreground transition-colors',
          )}
        >
          {chip}
          <ChevronUp
            aria-hidden
            className={cn(
              'text-primary h-3.5 w-3.5 transition-transform duration-150',
              open && 'rotate-180',
            )}
            strokeWidth={2.25}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-[min(15rem,calc(100vw-1.5rem))] p-0"
      >
        <div className="border-foreground/10 border-b px-4 pt-3 pb-2">
          <h3 className="text-foreground/70 font-mono text-[10px] tracking-[0.28em] uppercase">
            By continent
          </h3>
        </div>
        <ul role="list" className="divide-foreground/8 divide-y">
          {tally.map(({ continent, count }) => (
            <li key={continent} className="flex items-center justify-between gap-4 px-4 py-2">
              <span className="text-foreground/90 text-sm">{continent}</span>
              <span className="text-muted-foreground font-mono text-xs tabular-nums">
                {String(count).padStart(2, '0')}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
