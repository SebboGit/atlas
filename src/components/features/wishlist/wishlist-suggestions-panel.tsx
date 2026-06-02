'use client';

import { ChevronDown, Sparkles, UtensilsCrossed } from 'lucide-react';
import * as React from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { activityDataSchema, foodDataSchema } from '@/lib/segments';
import type { WishlistItem } from '@/lib/wishlist';
import { cn } from '@/lib/utils';

import { WishlistAddToTripButton } from './wishlist-add-to-trip-button';

interface WishlistSuggestionsPanelProps {
  tripId: string;
  items: readonly WishlistItem[];
}

function suggestionLabel(item: WishlistItem): string {
  if (item.type === 'food') {
    const parsed = foodDataSchema.safeParse(item.data);
    return parsed.success ? parsed.data.venue : 'Food spot';
  }
  const parsed = activityDataSchema.safeParse(item.data);
  return parsed.success ? parsed.data.title : 'Attraction';
}

// Collapsed-by-default disclosure pinned at the top of the Activity / Food
// tabs: wishlist items in this trip's countries (of that tab's type) not
// yet added here. Adding from a row materialises the item as an undated
// segment on the trip; the same item keeps surfacing on every OTHER trip
// that touches one of these countries — see the wishlist-architecture
// design. Collapsed so a long scheduled list isn't pushed down; the count
// in the header advertises what's inside.
export function WishlistSuggestionsPanel({ tripId, items }: WishlistSuggestionsPanelProps) {
  const [open, setOpen] = React.useState(false);
  if (items.length === 0) return null;

  return (
    <section className="atlas-rise mb-8" style={{ animationDelay: '220ms' }}>
      <button
        type="button"
        id="wishlist-suggestions-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="wishlist-suggestions-panel"
        className="group flex min-h-11 w-full items-center gap-3 text-left"
      >
        <ChevronDown
          aria-hidden
          strokeWidth={2.25}
          className={cn(
            'text-primary size-4 shrink-0 -rotate-90 transition-transform duration-150',
            open && 'rotate-0',
          )}
        />
        <span className="text-foreground/85 font-mono text-[10px] tracking-[0.28em] uppercase">
          From your wishlist
        </span>
        <span className="text-foreground/40 font-mono text-[10px] tracking-[0.2em]">
          · {String(items.length).padStart(2, '0')}
        </span>
        <span
          aria-hidden
          className="bg-foreground/15 group-hover:bg-foreground/25 h-px flex-1 transition-colors"
        />
      </button>

      {open && (
        <div
          id="wishlist-suggestions-panel"
          role="region"
          aria-labelledby="wishlist-suggestions-toggle"
          className="border-foreground/12 mt-4 border-b pb-8"
        >
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((item) => {
              const isFood = item.type === 'food';
              const label = suggestionLabel(item);
              return (
                <li key={item.id} className="h-full">
                  <Card variant="paper" className="h-full overflow-hidden">
                    <CardContent className="flex h-full items-center gap-4 px-4 py-4 sm:px-5">
                      <div
                        aria-hidden
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border [&_svg]:size-4',
                          isFood
                            ? 'border-accent/40 text-accent'
                            : 'border-primary/40 text-primary',
                        )}
                      >
                        {isFood ? (
                          <UtensilsCrossed strokeWidth={1.5} />
                        ) : (
                          <Sparkles strokeWidth={1.5} />
                        )}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="text-foreground/70 font-mono text-[9px] tracking-[0.28em] uppercase">
                          {isFood ? 'Food' : 'Activity'}
                        </p>
                        <p
                          title={label}
                          className="font-display text-foreground mt-0.5 truncate text-lg leading-tight font-medium tracking-tight"
                        >
                          {label}
                        </p>
                        {item.locationName && (
                          <p
                            title={item.locationName}
                            className="text-foreground/70 mt-0.5 truncate text-xs"
                          >
                            {item.locationName}
                          </p>
                        )}
                      </div>
                      <WishlistAddToTripButton itemId={item.id} tripId={tripId} kind={item.type} />
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
