'use client';

import { ChevronUp, MapPinOff } from 'lucide-react';
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { UngeocodedSegment } from '@/lib/trip-map/repo';

interface NotPinnedChipProps {
  items: UngeocodedSegment[];
}

/**
 * Bottom-left disclosure for segments that couldn't be placed on the
 * map. Replaces the long list that previously rendered below the map
 * (and below the fold on most viewports).
 *
 * Visually distinct from the wishlist toggle in the top-right:
 *   - `MapPinOff` icon — semantic match for "things that aren't pinned"
 *     (vs. the wishlist's dashed-circle, which signalled a binary toggle).
 *   - Chevron-up affordance that rotates on open — disclosure pattern,
 *     not a toggle.
 *   - No strong "active" colour shift when open — the popover itself is
 *     the active state; the chip stays neutral so the two corner
 *     controls don't read as a matched pair.
 */
export function NotPinnedChip({ items }: NotPinnedChipProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`${items.length} ${items.length === 1 ? 'segment' : 'segments'} not on the map`}
          className="border-foreground/20 bg-card/85 text-foreground/75 hover:border-foreground/30 hover:text-foreground absolute bottom-3 left-3 inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 font-mono text-[10px] tracking-[0.2em] uppercase backdrop-blur-sm transition-colors [@media(hover:hover)]:min-h-9 [@media(hover:hover)]:px-3 [@media(hover:hover)]:py-1.5"
        >
          <MapPinOff aria-hidden className="text-foreground/55 h-3.5 w-3.5" strokeWidth={1.5} />
          <span>Not pinned · {String(items.length).padStart(2, '0')}</span>
          <ChevronUp
            aria-hidden
            className={`text-foreground/45 h-3 w-3 transition-transform duration-150 ${
              open ? 'rotate-180' : ''
            }`}
            strokeWidth={2}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-[min(22rem,calc(100vw-1.5rem))] max-w-sm p-0"
      >
        <div className="border-foreground/10 border-b px-4 pt-3 pb-2">
          <h3 className="text-foreground/70 font-mono text-[10px] tracking-[0.28em] uppercase">
            Not on the map
          </h3>
        </div>
        <ul
          tabIndex={0}
          role="region"
          aria-label="Segments not on the map"
          className="divide-foreground/8 max-h-[min(18rem,calc(100svh-180px))] divide-y overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          {items.map((item) => (
            <li key={item.segmentId} className="flex flex-col gap-0.5 px-4 py-2.5">
              <span className="text-foreground/90 text-sm font-medium">{item.label}</span>
              <span className="text-muted-foreground text-xs leading-relaxed">{item.reason}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
