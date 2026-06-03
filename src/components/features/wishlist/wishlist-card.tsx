import { Pencil, Sparkles, UtensilsCrossed } from 'lucide-react';

import { ClientOnly } from '@/components/client-only';
import { PlusCodeBadge } from '@/components/features/segments/plus-code-badge';
import { Card, CardContent } from '@/components/ui/card';
import { countryName } from '@/lib/countries';
import { activityDataSchema, foodDataSchema } from '@/lib/segments';
import type { WishlistItem } from '@/lib/wishlist';

import { WishlistDeleteButton } from './wishlist-delete-button';
import { WishlistFormDialog } from './wishlist-form-dialog';

interface WishlistCardProps {
  item: WishlistItem;
  /** Display label such as "Sebastian" — surfaced as "added by …". */
  addedByLabel?: string | null;
  /**
   * Cached coordinates from `geocode_cache`. When present, the card
   * shows a clickable Plus Code badge that deep-links to Google Maps —
   * same pattern as segment cards.
   */
  coords?: { lat: number; lng: number } | null;
}

// Pull the headline name for a wishlist item from its per-type `data`.
// Falls back to a generic noun if the JSONB is malformed (shouldn't
// happen — the validator enforces it on write, but defensive read).
function headlineName(item: WishlistItem): string {
  if (item.type === 'food') {
    const parsed = foodDataSchema.safeParse(item.data);
    return parsed.success ? parsed.data.venue : 'Food spot';
  }
  const parsed = activityDataSchema.safeParse(item.data);
  return parsed.success ? parsed.data.title : 'Attraction';
}

// Pull the secondary descriptor — address when present (food/activity
// both expose one), locationName otherwise. Both are optional.
function subtitleText(item: WishlistItem): string | undefined {
  if (item.type === 'food') {
    const parsed = foodDataSchema.safeParse(item.data);
    const addr = parsed.success ? parsed.data.address : undefined;
    return addr || item.locationName || undefined;
  }
  const parsed = activityDataSchema.safeParse(item.data);
  const desc = parsed.success ? parsed.data.description : undefined;
  return desc || item.locationName || undefined;
}

export function WishlistCard({ item, addedByLabel, coords }: WishlistCardProps) {
  const name = headlineName(item);
  const subtitle = subtitleText(item);
  const country = countryName(item.countryCode) ?? item.countryCode;
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
          <div className="text-foreground/65 mt-1 flex flex-wrap items-baseline gap-2 text-xs">
            <span className="font-mono tracking-wider">{country}</span>
            {item.locationName && (
              <>
                <span aria-hidden className="text-foreground/30">
                  ·
                </span>
                <span>{item.locationName}</span>
              </>
            )}
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
