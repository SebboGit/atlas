import { Pencil, Sparkles, UtensilsCrossed } from 'lucide-react';
import { Fragment } from 'react';

import { ClientOnly } from '@/components/client-only';
import { PlusCodeBadge } from '@/components/features/segments/plus-code-badge';
import { Card, CardContent } from '@/components/ui/card';
import { countryName } from '@/lib/countries';
import { placeCity } from '@/lib/geocoding/place-city';
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
    <Card variant="paper" className="relative overflow-hidden">
      {/* Action cluster — edit + delete sit absolutely positioned so
       *  they don't compete with the card's title row. Hit area is
       *  44×44 on touch (CLAUDE.md) and visually 28×28 elsewhere so the
       *  card chrome stays quiet. Mounted client-only: both are Radix
       *  Dialogs whose useId-based ids drift between the server and client
       *  renders of the wishlist page, so SSR-ing them produced an
       *  aria-controls hydration mismatch (#68). Absolutely positioned, so
       *  deferring them to mount causes no layout shift. */}
      <ClientOnly>
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <WishlistFormDialog
            editingItem={item}
            trigger={
              <button
                type="button"
                aria-label="Edit this wishlist item"
                className="text-foreground/70 [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:bg-foreground/5 inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors [@media(hover:hover)]:h-7 [@media(hover:hover)]:w-7"
              >
                <Pencil className="size-3.5" strokeWidth={1.5} aria-hidden />
              </button>
            }
          />
          <WishlistDeleteButton itemId={item.id} noun={isFood ? 'food spot' : 'attraction'} />
        </div>
      </ClientOnly>

      <CardContent className="flex gap-4 py-5 pr-28 pl-5 sm:gap-5 sm:py-6 sm:pl-6">
        <div
          aria-hidden
          className="border-foreground/25 text-foreground/75 mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border [&_svg]:size-5"
        >
          {isFood ? (
            <UtensilsCrossed className="size-4" strokeWidth={1.5} />
          ) : (
            <Sparkles className="size-4" strokeWidth={1.5} />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="text-foreground/70 font-mono text-[10px] tracking-[0.28em] uppercase">
            {isFood ? 'Food' : 'Activity'}
          </p>
          <h3 className="font-display text-foreground text-xl leading-tight font-medium tracking-tight">
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
          <div className="text-foreground/65 mt-1 flex flex-wrap items-baseline gap-2 font-mono text-xs tracking-wider">
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
            <p className="text-foreground/70 mt-2 line-clamp-2 text-sm leading-snug">
              {item.notes}
            </p>
          )}
          {item.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="bg-foreground/8 text-foreground/70 inline-flex items-center rounded-full px-2 py-0.5 text-[11px]"
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
        </div>
      </CardContent>
    </Card>
  );
}
