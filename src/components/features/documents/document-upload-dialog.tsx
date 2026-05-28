'use client';

import { Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogEyebrow,
  DialogHeader,
  DialogScrollableBody,
  DialogStickyFooter,
  DialogTitle,
  DialogTrigger,
  dialogScrollContainer,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { uploadDocumentAction } from '@/lib/documents/actions';
import { formatBytes } from '@/lib/format';
import {
  DEFAULT_FILE_INPUT_ACCEPT,
  DEFAULT_FILE_INPUT_ACCEPT_HUMAN,
  formatMimeLabel,
} from '@/lib/storage/mimes';

interface DocumentUploadDialogProps {
  tripId: string;
  // Required when the dialog manages its own open state; optional when
  // driven by `open` + `onOpenChange` from outside (e.g. from a parent
  // DropdownMenu where the menu item is the affordance).
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Client picker hint. Sourced from the shared MIME module so it cannot
// drift from the server validator. A loose client allowlist is not a
// security boundary — the server is — but we want the picker to advertise
// the right thing so users can actually select .pkpass / .eml files.
const ACCEPT = DEFAULT_FILE_INPUT_ACCEPT;
const ACCEPT_HUMAN = DEFAULT_FILE_INPUT_ACCEPT_HUMAN;

export function DocumentUploadDialog({
  tripId,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: DocumentUploadDialogProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  if (isControlled && !controlledOnOpenChange) {
    throw new Error('DocumentUploadDialog: `onOpenChange` is required when `open` is provided.');
  }
  const open = isControlled ? (controlledOpen ?? false) : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<File | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset state when the dialog closes — picking a file in one open
  // session shouldn't leak into the next. Routed through `onOpenChange`
  // (and the explicit close paths below) so cleanup lives in the event
  // handler rather than an effect.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSelected(null);
      setError(null);
      formRef.current?.reset();
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setSelected(e.target.files?.[0] ?? null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!selected || selected.size === 0) {
      setError('Pick a file first.');
      return;
    }
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await uploadDocumentAction(tripId, formData);
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Upload failed.');
        return;
      }
      handleOpenChange(false);
      // Land the user on the Documents tab so they can see what they
      // just uploaded — and the Extract button, which only exists
      // there today. revalidatePath inside the action already
      // refreshed the cache; router.push will trigger the RSC pull
      // against fresh data.
      router.push(`/trips/${tripId}/documents`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="gap-1 sm:gap-2">
          <DialogEyebrow className="hidden sm:flex">
            <span aria-hidden className="bg-foreground/30 h-px w-6" />
            <span>Upload</span>
          </DialogEyebrow>
          <DialogTitle className="text-2xl sm:text-3xl">A new document.</DialogTitle>
          <DialogDescription className="hidden sm:block">
            Boarding pass, reservation, ticket — drop the original in. Atlas verifies the file type
            and stores it safely.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={onSubmit} className={dialogScrollContainer} noValidate>
          <DialogScrollableBody>
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor="doc-file">File</Label>
              <div className="border-foreground/15 bg-card/60 relative flex min-w-0 items-center gap-4 rounded-xl border border-dashed px-4 py-5 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]">
                <div
                  aria-hidden
                  className="border-foreground/20 text-foreground/65 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
                >
                  <Upload className="size-4" strokeWidth={1.5} />
                </div>
                <p
                  className={
                    selected
                      ? 'text-foreground min-w-0 flex-1 truncate text-sm'
                      : 'text-foreground/85 min-w-0 flex-1 truncate text-sm'
                  }
                  title={selected ? selected.name : undefined}
                >
                  {selected ? selected.name : 'Choose a file'}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => inputRef.current?.click()}
                  disabled={pending}
                  className="shrink-0"
                >
                  {selected ? 'Change' : 'Browse'}
                </Button>
                {/* Native input is visually hidden but stays in the form
                 *  so the FormData submit picks it up. */}
                <input
                  ref={inputRef}
                  id="doc-file"
                  type="file"
                  name="file"
                  accept={ACCEPT}
                  onChange={onFileChange}
                  className="sr-only"
                />
              </div>
              <p className="text-muted-foreground font-mono text-[10px] tracking-wider break-words">
                {selected
                  ? `${formatBytes(selected.size)} · ${formatMimeLabel(selected.type)}`
                  : ACCEPT_HUMAN}
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="border-destructive/30 bg-destructive/8 text-destructive rounded-xl border px-4 py-3 text-sm"
              >
                {error}
              </div>
            )}
          </DialogScrollableBody>

          <DialogStickyFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !selected}>
              {pending ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogStickyFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
