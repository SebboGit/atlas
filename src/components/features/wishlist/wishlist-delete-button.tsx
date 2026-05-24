'use client';

import { Trash2 } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogEyebrow,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { deleteWishlistItemAction } from '@/lib/wishlist/actions';

interface WishlistDeleteButtonProps {
  itemId: string;
  /** Short label used in the confirm dialog ("Remove this food spot?"). */
  noun?: string;
}

export function WishlistDeleteButton({ itemId, noun = 'item' }: WishlistDeleteButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteWishlistItemAction(itemId);
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Something went wrong.');
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Delete this ${noun}`}
          className="text-foreground/55 hover:text-destructive hover:bg-foreground/5 inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors [@media(hover:hover)]:h-7 [@media(hover:hover)]:w-7"
        >
          <Trash2 className="size-3.5" strokeWidth={1.5} aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>
            <span aria-hidden className="bg-foreground/30 h-px w-6" />
            <span>Delete {noun}</span>
          </DialogEyebrow>
          <DialogTitle>Remove this {noun}?</DialogTitle>
          <DialogDescription>
            Any trips that scheduled it keep their copy — the segment stays, just the wishlist link
            is dropped.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/8 text-destructive rounded-xl border px-4 py-3 text-sm"
          >
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="bg-destructive hover:bg-destructive/92 text-destructive-foreground"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
