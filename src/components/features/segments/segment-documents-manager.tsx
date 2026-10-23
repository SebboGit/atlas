'use client';

import { Check, Plus } from 'lucide-react';
import * as React from 'react';

import type { LinkedDocument } from '@/lib/documents';
import {
  listSegmentLinkOptionsAction,
  setSegmentDocumentLinkAction,
} from '@/lib/documents/actions';
import type { SegmentLinkOption } from '@/lib/documents/repo';
import { formatMimeLabel } from '@/lib/storage/mimes';

import { LinkedDocumentChips } from './linked-document-chips';

interface SegmentDocumentsManagerProps {
  tripId: string;
  segmentId: string;
  documents: LinkedDocument[];
}

// The info dialog's Documents section (#103): linked chips plus an
// Edit/Attach toggle that swaps in a list of every document on the
// trip, each row toggling its link to THIS segment. Manual attaches
// write `source = 'manual'` server-side, so a later re-extract of the
// document can never overwrite or delete the segment.
export function SegmentDocumentsManager({
  tripId,
  segmentId,
  documents,
}: SegmentDocumentsManagerProps) {
  const [editing, setEditing] = React.useState(false);
  const [options, setOptions] = React.useState<SegmentLinkOption[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, startLoading] = React.useTransition();
  // Row-level pending set so one slow toggle doesn't lock the list.
  const [pendingIds, setPendingIds] = React.useState<ReadonlySet<string>>(new Set());
  // Monotonic fetch id — Done → Manage inside one round-trip would
  // otherwise let the stale response clobber options applied after
  // the newer one landed.
  const fetchIdRef = React.useRef(0);

  // Once the authoritative list is loaded, derive the chips from it so
  // attach/detach reflects immediately — the RSC prop refresh from
  // revalidation lags a beat behind.
  const chipDocs: LinkedDocument[] =
    options === null
      ? documents
      : options
          .filter((o) => o.linked)
          .map(({ id, originalName, title, mime }) => ({ id, originalName, title, mime }));

  function openEditor() {
    setError(null);
    setEditing(true);
    const fetchId = ++fetchIdRef.current;
    startLoading(async () => {
      const result = await listSegmentLinkOptionsAction(tripId, segmentId);
      if (fetchId !== fetchIdRef.current) return;
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Something went wrong.');
        setEditing(false);
        return;
      }
      setOptions(result.value.options);
    });
  }

  function toggle(doc: SegmentLinkOption) {
    if (pendingIds.has(doc.id)) return;
    const next = !doc.linked;
    setError(null);
    setPendingIds((prev) => new Set(prev).add(doc.id));
    // Optimistic flip; revert on failure.
    setOptions((prev) =>
      prev ? prev.map((o) => (o.id === doc.id ? { ...o, linked: next } : o)) : prev,
    );
    // Shared by the Result-error branch and the rejection path (network
    // drop, unhandled server throw) — without the catch, a rejection
    // would leave the row disabled forever with the optimistic state
    // rendered but never written.
    const revert = (message: string) => {
      setOptions((prev) =>
        prev ? prev.map((o) => (o.id === doc.id ? { ...o, linked: doc.linked } : o)) : prev,
      );
      setError(message);
    };
    void setSegmentDocumentLinkAction({
      tripId,
      segmentId,
      documentId: doc.id,
      linked: next,
    })
      .then((result) => {
        if (!result.ok) revert(result.error.formMessage ?? 'Something went wrong.');
      })
      .catch(() => revert('Something went wrong.'))
      .finally(() => {
        setPendingIds((prev) => {
          const copy = new Set(prev);
          copy.delete(doc.id);
          return copy;
        });
      });
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <h4 className="text-foreground/70 font-mono text-[10px] tracking-[0.28em] uppercase">
          Documents
        </h4>
        {editing ? (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-foreground/70 hover:text-foreground font-mono text-[10px] tracking-[0.24em] uppercase transition-colors"
          >
            Done
          </button>
        ) : (
          <button
            type="button"
            onClick={openEditor}
            className="text-foreground/70 hover:text-foreground font-mono text-[10px] tracking-[0.24em] uppercase transition-colors"
          >
            {chipDocs.length > 0 ? 'Manage' : 'Attach'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {!editing ? (
        chipDocs.length > 0 ? (
          <LinkedDocumentChips documents={chipDocs} />
        ) : (
          <p className="text-muted-foreground text-sm">No documents.</p>
        )
      ) : loading || options === null ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : options.length === 0 ? (
        <p className="text-muted-foreground text-sm">No documents on this trip.</p>
      ) : (
        <ul className="border-foreground/10 divide-foreground/8 divide-y rounded-xl border">
          {options.map((doc) => {
            const pending = pendingIds.has(doc.id);
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => toggle(doc)}
                  disabled={pending}
                  aria-pressed={doc.linked}
                  className="hover:bg-foreground/4 flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:opacity-60"
                >
                  <span
                    aria-hidden
                    className={
                      doc.linked
                        ? 'border-primary bg-primary text-primary-foreground flex h-5 w-5 shrink-0 items-center justify-center rounded-full border'
                        : 'border-foreground/25 text-foreground/40 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border'
                    }
                  >
                    {doc.linked ? (
                      <Check className="size-3" strokeWidth={2} />
                    ) : (
                      <Plus className="size-3" strokeWidth={2} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground/90 block truncate text-sm leading-snug">
                      {doc.title ?? doc.originalName}
                    </span>
                    <span className="text-foreground/70 block font-mono text-[9px] tracking-[0.24em] uppercase">
                      {formatMimeLabel(doc.mime)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
