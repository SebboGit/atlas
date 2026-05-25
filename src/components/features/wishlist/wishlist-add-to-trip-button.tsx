'use client';

import { Check } from 'lucide-react';
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
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [added, setAdded] = React.useState(false);

  const tabLabel = kind === 'food' ? 'Food' : 'Activities';

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await addWishlistItemToTripAction(itemId, tripId);
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Could not add to trip.');
        return;
      }
      // Sticky confirmation — left visible until the parent revalidates
      // away this card. No timeout: the revalidatePath in the server
      // action unmounts this component within a frame or two.
      setAdded(true);
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
