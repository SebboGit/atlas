'use client';

import { CheckCircle2, Loader2, RotateCcw, Sparkles } from 'lucide-react';
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
import { extractDocumentAction } from '@/lib/documents/actions';

interface DocumentExtractButtonProps {
  tripId: string;
  documentId: string;
  /**
   * Lifecycle state computed by the parent RSC from the row (and a
   * stale-window check on `extractionStartedAt`). Five states:
   *
   *   idle        — never extracted, "Extract" button
   *   extracting  — job is in flight (and not stale), shows spinner
   *   extracted   — succeeded, "Extracted" chip
   *   failed      — last attempt failed (or a stale in-flight job
   *                 was forcibly demoted), shows "Retry extract"
   */
  state: 'idle' | 'extracting' | 'extracted' | 'failed';
}

// Small inline button that enqueues an extraction job for the document.
// The action returns immediately; the row's `extractionStartedAt`
// drives the "Extracting…" state, and the parent's polling component
// refreshes the page until the job clears it.
export function DocumentExtractButton({ tripId, documentId, state }: DocumentExtractButtonProps) {
  const [pending, startTransition] = React.useTransition();
  const [flashError, setFlashError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  function run() {
    if (pending || state === 'extracting') return;
    setFlashError(null);
    startTransition(async () => {
      const result = await extractDocumentAction(tripId, documentId);
      if (!result.ok) {
        setFlashError(result.error.formMessage ?? 'Extraction failed.');
        return;
      }
      // Successful enqueue. The action's revalidate flips `state` to
      // 'extracting' on the next RSC pass — no local bridge needed.
    });
  }

  if (state === 'extracted' && !pending && !flashError) {
    // Status indicator + re-extract affordance in one element. The
    // hover-swap from "Extracted" → "Re-extract" stays — it's the
    // visual cue on pointer devices that the chip is interactive — and
    // the click routes through a confirm dialog on every viewport.
    // Re-extracting is destructive (clears segment links, re-runs the
    // pipeline, replaces any auto-created segments), so a one-line
    // "here's what's about to happen" beats a silent overwrite even
    // when the user can see the hover hint. Dedup still collapses the
    // new extraction back to the existing flight if it produces the
    // same (carrier, number, date) tuple.
    return (
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="text-foreground/55 hover:text-foreground hover:bg-foreground/[0.04] group inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 font-mono text-[10px] tracking-[0.24em] uppercase transition-colors"
            title="Re-extract — overwrites the current parsed data and re-runs the pipeline."
          >
            <CheckCircle2 className="size-3 group-hover:hidden" strokeWidth={1.75} />
            <RotateCcw className="hidden size-3 group-hover:inline" strokeWidth={1.75} />
            <span className="group-hover:hidden">Extracted</span>
            <span className="hidden group-hover:inline">Re-extract</span>
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogEyebrow>
              <span aria-hidden className="bg-foreground/30 h-px w-6" />
              <span>Re-extract</span>
            </DialogEyebrow>
            <DialogTitle>Re-extract this document?</DialogTitle>
            <DialogDescription>
              This overwrites the current parsed data and re-runs the extraction pipeline. Any
              segments auto-created from the previous run will be replaced.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setConfirmOpen(false);
                run();
              }}
            >
              Re-extract
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (state === 'extracting') {
    return (
      <span
        className="text-foreground/55 inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 font-mono text-[10px] tracking-[0.24em] uppercase"
        title="Extraction is running in the background. The page will refresh when it's done."
      >
        <Loader2 className="size-3 animate-spin" strokeWidth={1.75} />
        Extracting…
      </span>
    );
  }

  const label = pending
    ? 'Queuing…'
    : flashError
      ? 'Retry'
      : state === 'failed'
        ? 'Retry extract'
        : 'Extract';

  return (
    <span className="flex items-center gap-2">
      {flashError && (
        <span
          role="status"
          className="text-destructive/85 font-mono text-[10px] tracking-wider"
          title={flashError}
        >
          Failed
        </span>
      )}
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="text-foreground/45 hover:text-foreground inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 font-mono text-[10px] tracking-[0.24em] uppercase transition-colors disabled:opacity-60"
        title="Run the extraction pipeline on this document"
      >
        <Sparkles className="size-3" strokeWidth={1.75} />
        {label}
      </button>
    </span>
  );
}
