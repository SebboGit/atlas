'use client';

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
import { archiveTripAction, deleteTripAction } from '@/lib/trips/actions';

type Mode = 'archive' | 'delete';

interface DeleteTripDialogProps {
  tripId: string;
  tripTitle: string;
  mode: Mode;
  trigger: React.ReactNode;
  /**
   * Count of documents currently attached to this trip. Only consumed
   * when `mode === 'delete'`. Used to surface the "also delete files"
   * choice and to drive the action's `deleteDocuments` flag.
   */
  attachedDocumentCount?: number;
}

const COPY: Record<
  Mode,
  {
    eyebrow: string;
    title: string;
    description: (title: string) => string;
    confirm: string;
    confirming: string;
    variant: 'ink' | 'default';
  }
> = {
  archive: {
    eyebrow: 'Archive',
    title: 'Move to archive?',
    description: (t) =>
      `“${t}” will move to the Archived view and disappear from your main list. Nothing is deleted — you can bring it back any time.`,
    confirm: 'Archive trip',
    confirming: 'Archiving…',
    variant: 'ink',
  },
  delete: {
    eyebrow: 'Permanently delete',
    title: 'Delete forever?',
    description: (t) =>
      `“${t}” and everything attached to it will be removed. There is no undo. If you might want it back, archive instead.`,
    confirm: 'Delete forever',
    confirming: 'Deleting…',
    variant: 'default',
  },
};

export function DeleteTripDialog({
  tripId,
  tripTitle,
  mode,
  trigger,
  attachedDocumentCount = 0,
}: DeleteTripDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  // Default to "also delete documents" per the trip-deletion design
  // decision (see ADR / inline note in deleteTripAction). The user
  // explicitly opts out via the checkbox if they want to keep the
  // documents (e.g. they were uploaded against the wrong trip).
  const [deleteDocs, setDeleteDocs] = React.useState(true);

  const copy = COPY[mode];
  const showDocChoice = mode === 'delete' && attachedDocumentCount > 0;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result =
        mode === 'archive'
          ? await archiveTripAction(tripId)
          : await deleteTripAction(tripId, { deleteDocuments: deleteDocs });
      // Hard delete redirects on success and never resolves an Ok value
      // — only an Err path returns. Archive returns a Result.
      if (result && !result.ok) {
        setError(result.error.formMessage ?? 'Something went wrong.');
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>
            <span aria-hidden className="bg-foreground/30 h-px w-6" />
            <span>{copy.eyebrow}</span>
          </DialogEyebrow>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description(tripTitle)}</DialogDescription>
        </DialogHeader>

        {showDocChoice && (
          <label className="border-foreground/12 bg-card/60 flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]">
            <input
              type="checkbox"
              className="border-foreground/30 text-primary focus-visible:ring-primary/40 focus-visible:ring-offset-background mt-0.5 size-4 shrink-0 rounded border bg-transparent transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              checked={deleteDocs}
              onChange={(e) => setDeleteDocs(e.target.checked)}
              disabled={pending}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-foreground">
                Also delete {attachedDocumentCount}{' '}
                {attachedDocumentCount === 1 ? 'document' : 'documents'} and their files
              </span>
              <span className="text-muted-foreground text-xs">
                {deleteDocs
                  ? 'Rows and originals on disk will be removed with the trip.'
                  : 'Documents will be kept and marked orphaned for later cleanup.'}
              </span>
            </span>
          </label>
        )}

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
          {mode === 'delete' ? (
            <Button
              type="button"
              variant="default"
              className="bg-destructive hover:bg-destructive/92 text-destructive-foreground"
              onClick={confirm}
              disabled={pending}
            >
              {pending ? copy.confirming : copy.confirm}
            </Button>
          ) : (
            <Button type="button" variant={copy.variant} onClick={confirm} disabled={pending}>
              {pending ? copy.confirming : copy.confirm}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
