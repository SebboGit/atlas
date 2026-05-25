'use client';

import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { addWishlistItemToTripAction } from '@/lib/wishlist/actions';
import type { WishlistItemType } from '@/lib/wishlist';

interface WishlistAddToTripButtonProps {
  itemId: string;
  tripId: string;
  /** Drives the confirmation label so the user knows which tab to look on. */
  kind: WishlistItemType;
}

// Inline "Add to trip" action. Single click materialises the wishlist
// item as an undated segment on the trip. On success the server
// invalidates /trips/[id] and /wishlist so the suggestions panel
// re-renders without this item — but the revalidation can take a beat
// to land, and a card silently disappearing while a new row turns up
// on a different tab is disorienting. So we hold a confirmation chip
// in place of the button for the moment between "action returned ok"
// and "the parent re-renders without us". By the time the chip
// would otherwise expire, the card is usually already gone.
export function WishlistAddToTripButton({ itemId, tripId, kind }: WishlistAddToTripButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [added, setAdded] = React.useState(false);
  // Refresh is delayed so the confirmation chip stays on screen long
  // enough to be readable. The timer ref lets us clear the pending
  // refresh if the component unmounts first (parent navigation,
  // HMR, etc.) — firing router.refresh on an unmounted component
  // is harmless but the cleanup is the polite default.
  const refreshTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const tabLabel = kind === 'food' ? 'Food' : 'Activities';

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await addWishlistItemToTripAction(itemId, tripId);
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Could not add to trip.');
        return;
      }
      // Sticky confirmation — left visible until we trigger the
      // router refresh below.
      setAdded(true);
      // `revalidatePath` in the server action invalidates the data
      // cache, but Next's router cache only refreshes on the NEXT
      // visit to a path — navigating to the map tab right after the
      // add would serve a stale wishlistPins prop (and the muted pin
      // for the just-materialised item would stick around). Force a
      // refresh of the current route + its layouts so every sibling
      // tab re-fetches on next navigation.
      //
      // The refresh is delayed ~1.5s so the user gets to actually
      // read the "✓ Added to <tab>" chip before the parent re-renders
      // and unmounts this card. If the user navigates away during
      // that window the cleanup effect clears the timer.
      refreshTimerRef.current = setTimeout(() => {
        router.refresh();
      }, 1500);
    });
  }

  if (added) {
    return (
      <span
        role="status"
        className="text-foreground/75 bg-foreground/8 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs whitespace-nowrap"
      >
        <Check aria-hidden className="size-3.5" strokeWidth={2} />
        Added to {tabLabel}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onClick}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? 'Adding…' : 'Add to trip'}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-xs leading-tight">
          {error}
        </p>
      )}
    </div>
  );
}
