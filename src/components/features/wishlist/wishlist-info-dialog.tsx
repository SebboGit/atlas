'use client';

import { Sparkles, UtensilsCrossed } from 'lucide-react';
import * as React from 'react';

import { InfoRow, InfoSection } from '@/components/features/segments/info-primitives';
import { PlusCodeBadge } from '@/components/features/segments/plus-code-badge';
import {
  Dialog,
  DialogContent,
  DialogEyebrow,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { countryName } from '@/lib/countries';
import { placeCity } from '@/lib/geocoding/place-city';
import type { WishlistItem } from '@/lib/wishlist';
import { cn } from '@/lib/utils';

import { wishlistAddress, wishlistItemName, wishlistPlusCode } from './wishlist-item-text';

interface WishlistInfoDialogProps {
  item: WishlistItem;
  /** Cached coordinates — drive the city line and the Maps deep link. */
  coords?: { lat: number; lng: number; city?: string | null } | null;
  /** Display label such as "Sebastian" — surfaced as "added by …". */
  addedByLabel?: string | null;
  children: React.ReactNode;
}

// Read-only inspector for a wishlist item, opened from a suggestion row
// on a trip's Food / Activities tab. Sibling in shape and behaviour to
// SegmentInfoDialog: the row itself is the trigger, and clicks that land
// on a nested control (the "Add to trip" button, the Plus Code link)
// keep their own behaviour.
//
// It exists because the suggestion row is deliberately terse — name,
// place, one button — which left everything else on the item (notes,
// tags, address, Plus Code, who saved it) unreachable without leaving
// the trip.
export function WishlistInfoDialog({
  item,
  coords,
  addedByLabel,
  children,
}: WishlistInfoDialogProps) {
  const [open, setOpen] = React.useState(false);
  const name = wishlistItemName(item);
  const isFood = item.type === 'food';

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    // `closest` walks up from the target, and this wrapper carries
    // role="button" itself, so it would always match. A hit equal to
    // the wrapper means the click landed on the row surface rather
    // than on a real nested affordance.
    const target = e.target as HTMLElement | null;
    const interactive = target?.closest('a, button, [role="button"]');
    if (interactive && interactive !== e.currentTarget) return;
    setOpen(true);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Strict identity, not a `closest` walk: keyboard activation already
    // targets the focused element, so a focused nested button gets its
    // own native activation and this wrapper correctly bails.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  }

  const country = countryName(item.countryCode);
  const address = wishlistAddress(item);
  const city = placeCity(coords, item.locationName, { country, text: address });
  const plusCode = wishlistPlusCode(item);
  const hasCoords = coords !== null && coords !== undefined;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`View details for ${name}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          // Layout-neutral (no box model), so swapping it in on mount
          // causes no shift.
          'group rounded-2xl outline-none',
          'cursor-pointer transition-[transform,box-shadow] duration-200',
          '[@media(hover:hover)]:hover:-translate-y-px [@media(hover:hover)]:hover:shadow-[0_28px_60px_-30px_rgba(60,40,20,0.32)]',
          'focus-visible:ring-primary/40 focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2',
        )}
      >
        {children}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          aria-describedby={undefined}
          className="gap-5 sm:p-6"
        >
          <DialogHeader className="gap-2">
            <DialogEyebrow>
              {isFood ? (
                <UtensilsCrossed className="size-3.5" strokeWidth={1.5} />
              ) : (
                <Sparkles className="size-3.5" strokeWidth={1.5} />
              )}
              <span>Wishlist · {isFood ? 'Food' : 'Activity'}</span>
            </DialogEyebrow>
            <DialogTitle className="text-2xl break-words">{name}</DialogTitle>
          </DialogHeader>

          {item.notes && (
            <InfoSection title="Notes">
              <div className="px-4 py-2.5">
                <p className="text-foreground/85 text-sm leading-relaxed whitespace-pre-wrap">
                  {item.notes}
                </p>
              </div>
            </InfoSection>
          )}

          <InfoSection title="Location">
            <InfoRow label="Area" value={item.locationName} />
            <InfoRow label="City" value={city} />
            <InfoRow label="Country" value={country} />
            <InfoRow label="Address" value={address} multiline />
            <InfoRow label="Plus Code" value={plusCode} mono />
            <InfoRow
              label="Map"
              value={
                hasCoords ? <PlusCodeBadge lat={coords.lat} lng={coords.lng} venue={name} /> : null
              }
            />
          </InfoSection>

          {item.tags.length > 0 && (
            <section className="flex flex-col gap-2">
              <h4 className="text-foreground/70 font-mono text-[10px] tracking-[0.28em] uppercase">
                Tags
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-foreground/8 text-foreground/70 inline-flex items-center rounded-full px-2 py-0.5 text-[11px]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          )}

          {addedByLabel && (
            <p className="text-foreground/65 font-mono text-[10px] tracking-[0.2em] uppercase">
              added by {addedByLabel}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
