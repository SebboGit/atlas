'use client';

import { ChevronDown, Sparkles, UtensilsCrossed } from 'lucide-react';
import * as React from 'react';

import { useMounted } from '@/components/client-only';
import { Card, CardContent } from '@/components/ui/card';
import { countryName } from '@/lib/countries';
import { placeCity } from '@/lib/geocoding/place-city';
import type { WishlistItem } from '@/lib/wishlist';
import { cn } from '@/lib/utils';

import { WishlistAddToTripButton } from './wishlist-add-to-trip-button';
import { WishlistInfoDialog } from './wishlist-info-dialog';
import { wishlistItemName } from './wishlist-item-text';

/** Coordinates as the trip tab pages resolve them. */
type Coords = { lat: number; lng: number; city?: string | null };

interface WishlistSuggestionsPanelProps {
  tripId: string;
  items: readonly WishlistItem[];
  /**
   * Open on first render. The pages set this when the tab has no
   * segments of its type — with nothing else on screen, a collapsed
   * disclosure is the only thing to act on and shouldn't need a click
   * to reveal itself.
   */
  defaultOpen?: boolean;
  /** Resolved coords per item id, for the city half of the place line. */
  coordsById?: ReadonlyMap<string, Coords>;
  /** userId → display name, for the info dialog's "added by …". */
  namesByUserId?: ReadonlyMap<string, string>;
}

// Disclosure pinned at the top of the Activity / Food tabs: wishlist
// items in this trip's countries (of that tab's type) not yet added
// here. Adding from a row materialises the item as an undated segment
// on the trip; the same item keeps surfacing on every OTHER trip that
// touches one of these countries — see the wishlist-architecture design.
//
// Collapsed by default so a long scheduled list isn't pushed down, but
// it is now a bordered container with a filled header band rather than
// the bare hairline rule it used to be: as a naked eyebrow it read as a
// section divider, and people didn't know there was anything behind it.
export function WishlistSuggestionsPanel({
  tripId,
  items,
  defaultOpen = false,
  coordsById,
  namesByUserId,
}: WishlistSuggestionsPanelProps) {
  // Initial state only — deliberately NOT re-derived. Once "Add to
  // trip" turns a zero-segment tab into a one-segment tab, the panel
  // must not snap shut under the cursor.
  const [open, setOpen] = React.useState(defaultOpen);
  if (items.length === 0) return null;

  // Advertises what is inside while collapsed. Hidden on phones, where
  // the header row has no width to spare.
  const preview = items
    .slice(0, 2)
    .map((i) => wishlistItemName(i))
    .join(', ');
  const overflow = items.length - Math.min(items.length, 2);

  return (
    <section className="atlas-rise mb-8" style={{ animationDelay: '220ms' }}>
      <div className="border-foreground/15 bg-foreground/[0.02] overflow-hidden rounded-2xl border">
        <button
          type="button"
          id="wishlist-suggestions-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="wishlist-suggestions-panel"
          className={cn(
            'group flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors',
            'bg-foreground/[0.04] [@media(hover:hover)]:hover:bg-foreground/[0.07]',
            // Inset ring: the container clips overflow, so an outward
            // offset ring would be cut off on three sides.
            'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
            open && 'border-foreground/12 border-b',
          )}
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
          {!open && preview && (
            <span className="text-foreground/55 hidden min-w-0 flex-1 truncate text-xs sm:block">
              {preview}
              {overflow > 0 && ` +${overflow}`}
            </span>
          )}
        </button>

        {open && (
          <div
            id="wishlist-suggestions-panel"
            role="region"
            aria-labelledby="wishlist-suggestions-toggle"
            className="p-3 sm:p-4"
          >
            <ul className="grid gap-3 sm:grid-cols-2">
              {items.map((item) => (
                <li key={item.id} className="h-full">
                  <SuggestionRow
                    item={item}
                    tripId={tripId}
                    coords={coordsById?.get(item.id) ?? null}
                    addedByLabel={namesByUserId?.get(item.createdBy) ?? null}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function SuggestionRow({
  item,
  tripId,
  coords,
  addedByLabel,
}: {
  item: WishlistItem;
  tripId: string;
  coords: Coords | null;
  addedByLabel: string | null;
}) {
  // The row is the info-dialog trigger, and that dialog is a Radix
  // Dialog whose useId-derived ids drift between the server and client
  // renders of these async RSC tab pages (#68). The panel can now open
  // on first render, so the rows would SSR — mount-gate the trigger and
  // show the bare card until then. The wrapper is layout-neutral, so
  // nothing shifts when it attaches.
  const mounted = useMounted();
  const card = <SuggestionCard item={item} tripId={tripId} coords={coords} />;
  if (!mounted) return card;
  return (
    <WishlistInfoDialog item={item} coords={coords} addedByLabel={addedByLabel}>
      {card}
    </WishlistInfoDialog>
  );
}

function SuggestionCard({
  item,
  tripId,
  coords,
}: {
  item: WishlistItem;
  tripId: string;
  coords: Coords | null;
}) {
  const isFood = item.type === 'food';
  const label = wishlistItemName(item);
  const country = countryName(item.countryCode);
  // Fine → coarse, so the most specific thing on file leads. Country
  // always renders: a trip can span several, and "Ippudo" on its own
  // never said which one this was.
  const place = [item.locationName, placeCity(coords, item.locationName, { country }), country]
    .filter((p): p is string => Boolean(p))
    .join(' · ');

  return (
    <Card variant="paper" className="h-full overflow-hidden">
      <CardContent className="flex h-full items-center gap-4 px-4 py-4 sm:px-5">
        <div
          aria-hidden
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border [&_svg]:size-4',
            isFood ? 'border-accent/40 text-accent' : 'border-primary/40 text-primary',
          )}
        >
          {isFood ? <UtensilsCrossed strokeWidth={1.5} /> : <Sparkles strokeWidth={1.5} />}
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
          <p title={place} className="text-foreground/70 mt-0.5 truncate text-xs">
            {place}
          </p>
        </div>
        {/* In flow rather than an absolute lane: the button swaps to a
         *  wider "Added to …" chip and can grow an error line beneath,
         *  which a fixed lane would let overlap the title at 360px. It
         *  sits inside the dialog trigger, whose click filter defers to
         *  nested controls — the same arrangement document chips use
         *  inside SegmentInfoDialog. */}
        <WishlistAddToTripButton itemId={item.id} tripId={tripId} kind={item.type} />
      </CardContent>
    </Card>
  );
}
