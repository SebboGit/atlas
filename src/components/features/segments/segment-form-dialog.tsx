'use client';

import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { Segment, SegmentType } from '@/lib/segments';
import {
  createSegmentAction,
  type FormError,
  loadFlightLegGroupAction,
  updateSegmentAction,
} from '@/lib/segments/actions';
import type { Result } from '@/types/result';

import { MultiLegFlightForm } from './multi-leg-flight-form';
import { SegmentForm } from './segment-form';
import type { FormInput } from './segment-form-fields/_helpers';

interface SegmentFormDialogProps {
  tripId: string;
  trigger: React.ReactNode;
  // When set, the form opens locked to that segment type. Used by
  // tab-scoped "Add flight" / "Add hotel" / etc. buttons.
  defaultType?: SegmentType;
  // When set, the dialog opens in edit mode — prefilled with the
  // segment's values and wired to updateSegmentAction. Mutually
  // exclusive with `defaultType` (an edit dialog always knows the
  // type from the segment row).
  editingSegment?: Segment;
}

const CREATE_TITLES: Record<SegmentType, string> = {
  flight: 'New flight',
  hotel: 'New stay',
  activity: 'New activity',
  transit: 'New transit',
  food: 'New meal',
  note: 'New note',
};

const EDIT_TITLES: Record<SegmentType, string> = {
  flight: 'Edit flight',
  hotel: 'Edit stay',
  activity: 'Edit activity',
  transit: 'Edit transit',
  food: 'Edit meal',
  note: 'Edit note',
};

const GENERIC_TITLE = 'New segment';

// Grace period before the leg-group load surfaces a "Loading…" label.
// Longer than a healthy indexed leg-group query (<100ms) so the common
// case never flashes; short enough that a genuinely slow load still
// gets feedback well under 1s.
const LOADING_GRACE_MS = 140;

// Translate a persisted Segment into the form's input shape. Dates
// land as Date objects (RHF's defaultValues accepts them via the
// `dateInput` union in validators.ts); strings on the row come
// through unchanged.
function segmentToFormInput(segment: Segment): FormInput {
  return {
    type: segment.type,
    data: segment.data,
    startsAt: segment.startsAt,
    endsAt: segment.endsAt,
    locationName: segment.locationName ?? '',
    countryCode: segment.countryCode ?? '',
    originCountryCode: segment.originCountryCode ?? '',
  } as FormInput;
}

export function SegmentFormDialog({
  tripId,
  trigger,
  defaultType,
  editingSegment,
}: SegmentFormDialogProps) {
  const [open, setOpen] = React.useState(false);
  // Sibling-leg group for the multi-leg flight-edit path. Loaded
  // on dialog-open (in the `onOpenChange` handler — the project
  // rule is "no setState inside effects"); the result is the
  // chronologically-ordered list of every flight segment sharing a
  // document or PNR with the one being edited, plus the segment
  // itself. A length of 1 means "no siblings, fall back to the
  // single-segment SegmentForm". `null` is the loading state.
  const [legGroup, setLegGroup] = React.useState<Segment[] | null>(null);
  const [legGroupError, setLegGroupError] = React.useState<string | null>(null);
  // The leg-group load is a single indexed query — typically <100ms.
  // Painting "Loading…" for that window produces a flash (mount then
  // immediate unmount). We only flip this true after a short grace
  // period, so a fast resolve swaps straight from trigger to form
  // with no intermediate loading surface; a genuinely slow query
  // still gets feedback. Cleared on resolve and on close.
  const [showLoading, setShowLoading] = React.useState(false);
  // Token bumped on every open/close — late-arriving fetches check
  // it to bail out instead of racing setLegGroup against a newer
  // open or a close-then-reopen. Refs avoid a re-render on bump.
  const fetchTokenRef = React.useRef(0);
  // Pending grace-period timer for `showLoading`. Cleared whenever
  // the load resolves early or the dialog closes, so a stale timer
  // can't surface the loading state after the fact.
  const loadingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFlightEdit = editingSegment?.type === 'flight';

  // Belt-and-braces: drop any pending loading timer if the component
  // unmounts mid-fetch. The token guard already neutralises a stale
  // resolve, but the timer itself should never outlive the dialog.
  React.useEffect(() => {
    return () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, []);

  // Every open/close transition — user-initiated (escape / outside
  // click / trigger toggle) AND form-initiated (save success,
  // cancel) — funnels through this handler. On open it discards the
  // previous open's `legGroup`; without that discard the next open
  // would paint `MultiLegFlightForm` with stale segments before the
  // new fetch lands, and the form's drafts state (initialised once
  // via useState) would be permanently stuck one save behind the DB.
  // The discard lives here on the open path rather than on close so
  // that closing leaves the last-rendered form in place for Radix's
  // exit animation (see the close branch below).
  function handleOpenChange(next: boolean) {
    setOpen(next);
    const myToken = ++fetchTokenRef.current;
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
    if (!next) {
      // Don't reset `legGroup` here — Radix keeps DialogContent
      // mounted through its ~200ms exit animation, and a reset to
      // null would re-render the "Loading…" surface for the whole
      // close transition. Leave the last-rendered form in place so
      // the dialog animates out over stable content; the next open
      // bumps the fetch token and reloads from scratch anyway.
      setShowLoading(false);
      setLegGroupError(null);
      return;
    }
    // Fresh open: discard the previous open's group so a multi-leg
    // form can't paint with stale segments before the new fetch
    // lands (the reason this used to live in the close path). Reset
    // the error here too, so the fresh-open reset is one cohesive
    // block that doesn't depend on the close path also clearing it.
    setLegGroup(null);
    setShowLoading(false);
    setLegGroupError(null);
    if (!isFlightEdit || !editingSegment) return;
    const seg = editingSegment;
    // Arm the loading surface behind a grace period — a sub-100ms
    // resolve clears the timer before it fires, so the common case
    // never flashes a loading state.
    loadingTimerRef.current = setTimeout(() => {
      if (fetchTokenRef.current === myToken) setShowLoading(true);
    }, LOADING_GRACE_MS);
    void loadFlightLegGroupAction(tripId, seg.id)
      .then((result) => {
        if (fetchTokenRef.current !== myToken) return;
        if (loadingTimerRef.current) {
          clearTimeout(loadingTimerRef.current);
          loadingTimerRef.current = null;
        }
        setShowLoading(false);
        if (result.ok) {
          setLegGroup(result.value);
        } else {
          // Fall back to the single-segment SegmentForm — surface the
          // server's message in a banner above the form so the user
          // knows why tabs aren't appearing (most likely cause: the
          // segment was deleted in another tab during the click).
          setLegGroup([seg]);
          setLegGroupError(result.error.formMessage ?? null);
        }
      })
      .catch(() => {
        // The action's *expected* failures return an err(...) Result
        // (handled above). This branch is for a thrown rejection —
        // most importantly requireUser() throwing when the session
        // has expired while the trip page sat open. Degrade to the
        // single-segment form so manual entry stays possible
        // (guardrail #4); this is an explicit handle, not a silent
        // catch (guardrail #12).
        if (fetchTokenRef.current !== myToken) return;
        if (loadingTimerRef.current) {
          clearTimeout(loadingTimerRef.current);
          loadingTimerRef.current = null;
        }
        setShowLoading(false);
        setLegGroup([seg]);
        setLegGroupError('Could not load related flights. Please try again.');
      });
  }

  const submit = React.useCallback(
    async (input: unknown): Promise<Result<{ id: string }, FormError>> => {
      if (editingSegment) {
        return updateSegmentAction(tripId, editingSegment.id, input);
      }
      return createSegmentAction(tripId, input);
    },
    [tripId, editingSegment],
  );

  const title = editingSegment
    ? EDIT_TITLES[editingSegment.type]
    : defaultType
      ? CREATE_TITLES[defaultType]
      : GENERIC_TITLE;

  const initialValues = editingSegment ? segmentToFormInput(editingSegment) : undefined;
  const submitLabel = editingSegment ? 'Save changes' : undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        // Match TripFormDialog: don't autofocus the first field
        // (scrolls the heading off-screen) and don't close when the
        // user opens a Radix popover (date picker) inside.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest('[data-radix-popper-content-wrapper]')) {
            e.preventDefault();
          }
        }}
        // No DialogDescription on this compact header — field labels
        // already tell the user what to do. Suppress Radix's a11y
        // warning by explicitly nulling out aria-describedby.
        aria-describedby={undefined}
        // Tighter padding + gap than the default dialog so the form
        // (long: many fields, two date+time rows, a country row) fits
        // without forcing the dialog to scroll and clipping the
        // submit button below the fold.
        className="gap-4 sm:p-6"
      >
        <DialogHeader className="gap-0">
          <DialogTitle className="text-xl">{title}</DialogTitle>
        </DialogHeader>

        {/*
          Flight-edit branching: when the sibling-load action returns
          ≥2 flight segments, swap in the multi-leg form (tabs per
          leg, single atomic Save via updateFlightLegsAction). Otherwise
          render the existing SegmentForm.

          While the leg-group load is in flight (`legGroup === null`)
          we hold an empty placeholder rather than the form — the
          multi-leg form's drafts are seeded once on mount, so it must
          not mount until the group is known. The "Loading…" label is
          gated on `open && showLoading`:
            - `open` keeps it from re-appearing during Radix's exit
              animation (DialogContent stays mounted ~200ms after
              close — a null-reset there would flash "Loading…").
            - `showLoading` is armed behind a grace period in
              handleOpenChange, so a sub-100ms resolve (the common
              case) swaps straight from trigger to form with no
              flash. A genuinely slow query still gets the label.
        */}
        {isFlightEdit && editingSegment && legGroup === null ? (
          <div className="text-foreground/60 px-1 py-6 text-center text-sm" aria-hidden={!open}>
            {open && showLoading ? 'Loading…' : ' '}
          </div>
        ) : isFlightEdit && legGroup && legGroup.length > 1 ? (
          <>
            {legGroupError && (
              <div
                role="alert"
                className="border-destructive/30 bg-destructive/8 text-destructive rounded-xl border px-4 py-3 text-sm"
              >
                {legGroupError}
              </div>
            )}
            <MultiLegFlightForm
              tripId={tripId}
              segments={legGroup}
              initialActiveSegmentId={editingSegment.id}
              onSuccess={() => handleOpenChange(false)}
              onCancel={() => handleOpenChange(false)}
            />
          </>
        ) : (
          <SegmentForm
            defaultType={defaultType}
            initialValues={initialValues}
            submitLabel={submitLabel}
            onSubmit={submit}
            onSuccess={() => handleOpenChange(false)}
            onCancel={() => handleOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
