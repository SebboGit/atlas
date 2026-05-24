'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { addWishlistItemToTripAction } from '@/lib/wishlist/actions';

interface WishlistAddToTripButtonProps {
  itemId: string;
  tripId: string;
}

// Inline "Add to trip" action. Single click materialises the wishlist
// item as an undated segment on the trip. On success the server
// invalidates /trips/[id] and /wishlist so the suggestions panel
// re-renders without this item — no client-side optimistic removal
// needed, the revalidate handles it.
export function WishlistAddToTripButton({ itemId, tripId }: WishlistAddToTripButtonProps) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await addWishlistItemToTripAction(itemId, tripId);
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Could not add to trip.');
      }
    });
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
