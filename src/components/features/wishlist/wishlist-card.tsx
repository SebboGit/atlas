import { Pencil, Sparkles, UtensilsCrossed } from 'lucide-react';
import { Fragment } from 'react';

import { ClientOnly } from '@/components/client-only';
import { PlusCodeBadge } from '@/components/features/segments/plus-code-badge';
import { SEGMENT_INK, SEGMENT_TONE } from '@/components/features/segments/segment-tone';
import { Card, CardContent } from '@/components/ui/card';
import { countryName } from '@/lib/countries';
import { placeCity } from '@/lib/geocoding/place-city';
import { cn } from '@/lib/utils';
import type { WishlistItem } from '@/lib/wishlist';

import { WishlistDeleteButton } from './wishlist-delete-button';
import { WishlistFormDialog } from './wishlist-form-dialog';
import { wishlistItemName, wishlistSubtitle } from './wishlist-item-text';

interface WishlistCardProps {
  item: WishlistItem;
  /** Display label such as "Sebastian" — surfaced as "added by …". */
  addedByLabel?: string | null;
  /**
   * Cached coordinates from `geocode_cache`. When present, the card
   * shows a clickable Plus Code badge that deep-links to Google Maps —
   * same pattern as segment cards. `city` is the geocoder's coarse
   * locality, which is the only thing that says where an item saved
   * with nothing but a Plus Code actually is.
   */
  coords?: { lat: number; lng: number; city?: string | null } | null;
}

export function WishlistCard({ item, addedByLabel, coords }: WishlistCardProps) {
  const name = wishlistItemName(item);
  const subtitle = wishlistSubtitle(item);
  const country = countryName(item.countryCode);
  // Coarse → fine, so a Plus-Code-only item still reads "Japan · Osaka"
  // instead of just "Japan". Suppressed only when the user's own area
  // label already says it — an address containing the city does not
  // count, since this row is where "where is this?" gets answered.
  const city = placeCity(coords, item.locationName, { country });
  const meta = [country, city, item.locationName].filter((p): p is string => Boolean(p));
  const isFood = item.type === 'food';
  const hasBadge =
    coords !== null &&
    coords !== undefined &&
    Number.isFinite(coords.lat) &&
    Number.isFinite(coords.lng);

  return (
    // A ticket with its stub as a strip across the top, in the type's tone
    // (the same tone the type carries on trip tickets and map pins).
    <Card variant="paper" className="ticket relative flex flex-col overflow-hidden">
      {/* Action cluster — edit + delete sit absolutely positioned so
       *  they don't compete with the card's title row. Hit area is
       *  44×44 on touch (CLAUDE.md) and visually 28×28 elsewhere so the
       *  card chrome stays quiet. Mounted client-only: both are Radix
       *  Dialogs whose useId-based ids drift between the server and client
       *  renders of the wishlist page, so SSR-ing them produced an
       *  aria-controls hydration mismatch (#68). Absolutely positioned, so
       *  deferring them to mount causes no layout shift. */}
      <ClientOnly>
        <div
          className={cn(
            // z-10: the strip below is positioned (its perforation notches) and
            // would otherwise paint over the cluster.
            'absolute top-2 right-2 z-10 flex items-center gap-1',
            SEGMENT_INK[isFood ? 'food' : 'activity'],
          )}
        >
          <WishlistFormDialog
            editingItem={item}
            trigger={
              <button
                type="button"
                aria-label="Edit this wishlist item"
                className="[@media(hover:hover)]:hover:bg-card/60 inline-flex h-11 w-11 items-center justify-center rounded-full text-current transition-colors [@media(hover:hover)]:h-7 [@media(hover:hover)]:w-7"
              >
                <Pencil className="size-3.5" strokeWidth={1.5} aria-hidden />
              </button>
            }
          />
          <WishlistDeleteButton itemId={item.id} noun={isFood ? 'food spot' : 'attraction'} />
        </div>
      </ClientOnly>

      {/* The strip reserves the action cluster's lane on its right. */}
      <div
        className={cn(
          'ticket-stub-top flex min-h-[3.75rem] items-center gap-2 py-3 pr-28 pl-4 sm:pl-5',
          SEGMENT_TONE[isFood ? 'food' : 'activity'],
        )}
      >
        {isFood ? (
          <UtensilsCrossed aria-hidden className="size-4 shrink-0" strokeWidth={2} />
        ) : (
          <Sparkles aria-hidden className="size-4 shrink-0" strokeWidth={2} />
        )}
        <span className="font-mono text-[11px] font-medium tracking-[0.06em] uppercase">
          {isFood ? 'Food' : 'Activity'}
        </span>
      </div>

      <CardContent className="flex flex-1 flex-col gap-1.5 px-4 pt-4 pb-5 sm:px-5">
        <h3 className="font-display text-foreground text-xl leading-tight tracking-tight break-words">
          {name}
        </h3>
        {(subtitle || hasBadge) && (
          <p className="text-muted-foreground inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-snug">
            {subtitle && <span>{subtitle}</span>}
            {hasBadge && <PlusCodeBadge lat={coords.lat} lng={coords.lng} venue={name} />}
          </p>
        )}
        {/* One identity strip, one typeface. Country, city and area are
         *  the same KIND of value — where this is — so they read as a
         *  single mono run rather than a mono country followed by two
         *  sans place names. */}
        <div className="text-muted-foreground mt-1 flex flex-wrap items-baseline gap-2 font-mono text-xs">
          {meta.map((part, i) => (
            <Fragment key={`${i}:${part}`}>
              {i > 0 && (
                <span aria-hidden className="text-foreground/30">
                  ·
                </span>
              )}
              <span>{part}</span>
            </Fragment>
          ))}
        </div>
        {item.notes && (
          <p className="text-foreground/85 mt-2 line-clamp-2 text-sm leading-snug">{item.notes}</p>
        )}
        {item.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="bg-muted text-foreground/80 inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {addedByLabel && (
          <p className="text-foreground/65 mt-2 font-mono text-[10px] tracking-[0.2em] uppercase">
            added by {addedByLabel}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
