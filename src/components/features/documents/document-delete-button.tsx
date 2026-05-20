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
import { deleteDocumentAction } from '@/lib/documents/actions';

interface DocumentDeleteButtonProps {
  tripId: string;
  documentId: string;
}

// Small destructive button that confirms before firing. Document
// deletion is permanent — both the row and the file on disk go.
export function DocumentDeleteButton({ tripId, documentId }: DocumentDeleteButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteDocumentAction(tripId, documentId);
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
          aria-label="Delete document"
          className="text-foreground/40 hover:text-destructive inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors"
        >
          <Trash2 className="size-3.5" strokeWidth={1.5} />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogEyebrow>
            <span aria-hidden className="bg-foreground/30 h-px w-6" />
            <span>Delete document</span>
          </DialogEyebrow>
          <DialogTitle>Remove this document?</DialogTitle>
          <DialogDescription>
            The file will be removed from disk too. There is no undo.
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
