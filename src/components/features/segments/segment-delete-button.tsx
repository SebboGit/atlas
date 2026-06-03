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
import { deleteSegmentAction } from '@/lib/segments/actions';

interface SegmentDeleteButtonProps {
  tripId: string;
  segmentId: string;
  // Short label used in the confirm dialog ("Delete this flight?").
  // Falls back to "segment" if not provided.
  noun?: string;
}

// Compact destructive-action button suitable for placement on segment
// cards. Opens a confirm dialog before firing the action.
export function SegmentDeleteButton({
  tripId,
  segmentId,
  noun = 'segment',
}: SegmentDeleteButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteSegmentAction(tripId, segmentId);
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
          // 44px touch hit-area; the glyph is unboxed, so the larger
          // target stays invisible. Shrinks to 28px on pointer devices.
          className="text-foreground/40 [@media(hover:hover)]:hover:text-destructive inline-flex size-11 items-center justify-center rounded-full transition-colors [@media(hover:hover)]:size-7"
        >
          <Trash2 className="size-3.5" strokeWidth={1.5} />
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
            This {noun} is being removed. This does not remove any attached documents.
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
