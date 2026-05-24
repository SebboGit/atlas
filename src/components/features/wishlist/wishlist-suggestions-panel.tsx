import { Sparkles, UtensilsCrossed } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { activityDataSchema, foodDataSchema } from '@/lib/segments';
import type { WishlistItem } from '@/lib/wishlist';

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

// Suggestions panel rendered on the itinerary tab — wishlist items in
// any of this trip's countries that aren't already on the trip. Adding
// from here materialises the item into an undated segment on the
// matching tab; the same item keeps surfacing on every OTHER trip
// that touches one of these countries.
export function WishlistSuggestionsPanel({ tripId, items }: WishlistSuggestionsPanelProps) {
  if (items.length === 0) return null;

  return (
    <section className="atlas-rise mt-12 flex flex-col gap-4" style={{ animationDelay: '500ms' }}>
      <header className="flex items-baseline gap-3">
        <p className="text-foreground/65 font-mono text-[10px] tracking-[0.28em] uppercase">
          From your wishlist
        </p>
        <span className="text-foreground/40 font-mono text-[10px] tracking-[0.2em]">
          · {String(items.length).padStart(2, '0')}
        </span>
        <span aria-hidden className="bg-foreground/15 h-px flex-1" />
      </header>
      <p className="text-muted-foreground -mt-1 text-xs">
        Places in this trip&rsquo;s countries you haven&rsquo;t added yet.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const isFood = item.type === 'food';
          const label = suggestionLabel(item);
          return (
            <li key={item.id}>
              <Card variant="paper" className="overflow-hidden">
                <CardContent className="flex items-center gap-4 px-4 py-4 sm:px-5">
                  <div
                    aria-hidden
                    className="border-foreground/25 text-foreground/65 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border [&_svg]:size-4"
                  >
                    {isFood ? (
                      <UtensilsCrossed strokeWidth={1.5} />
                    ) : (
                      <Sparkles strokeWidth={1.5} />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="text-foreground/55 font-mono text-[9px] tracking-[0.28em] uppercase">
                      {isFood ? 'Food' : 'Activity'}
                    </p>
                    <p className="font-display text-foreground mt-0.5 truncate text-lg leading-tight font-medium tracking-tight">
                      {label}
                    </p>
                    {item.locationName && (
                      <p className="text-foreground/55 mt-0.5 truncate text-xs">
                        {item.locationName}
                      </p>
                    )}
                  </div>
                  <WishlistAddToTripButton itemId={item.id} tripId={tripId} />
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
