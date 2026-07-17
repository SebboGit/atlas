'use client';

import { Pencil } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { renameDocumentAction } from '@/lib/documents/actions';

interface DocumentRenameDialogProps {
  tripId: string;
  documentId: string;
  title: string | null;
  originalName: string;
}

// Pencil-next-to-title trigger opening a one-field rename dialog.
// Clearing the field reverts display to the original filename — the
// file itself is never renamed (immutable original, see #102).
export function DocumentRenameDialog({
  tripId,
  documentId,
  title,
  originalName,
}: DocumentRenameDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = inputRef.current?.value ?? '';
    setError(null);
    startTransition(async () => {
      const result = await renameDocumentAction(tripId, documentId, value);
      if (!result.ok) {
        setError(result.error.fields?.title ?? result.error.formMessage ?? 'Something went wrong.');
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
          aria-label="Rename document"
          className="text-foreground/40 hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors"
        >
          <Pencil className="size-3.5" strokeWidth={1.5} />
        </button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogEyebrow>
              <span aria-hidden className="bg-foreground/30 h-px w-6" />
              <span>Rename document</span>
            </DialogEyebrow>
            <DialogTitle>Display title</DialogTitle>
            <DialogDescription className="truncate font-mono text-[10px] tracking-wider">
              Original: {originalName}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`rename-${documentId}`} className="sr-only">
              Display title
            </Label>
            <Input
              id={`rename-${documentId}`}
              ref={inputRef}
              defaultValue={title ?? ''}
              placeholder={originalName}
              maxLength={200}
              autoFocus
            />
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </div>

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
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
