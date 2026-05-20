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
  note: 'New note',
};

const EDIT_TITLES: Record<SegmentType, string> = {
  flight: 'Edit flight',
  hotel: 'Edit stay',
  activity: 'Edit activity',
  transit: 'Edit transit',
  note: 'Edit note',
};

const GENERIC_TITLE = 'New segment';

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
  // Token bumped on every open/close — late-arriving fetches check
  // it to bail out instead of racing setLegGroup against a newer
  // open or a close-then-reopen. Refs avoid a re-render on bump.
  const fetchTokenRef = React.useRef(0);
  const isFlightEdit = editingSegment?.type === 'flight';

  // Every close path — user-initiated (escape / outside click /
  // trigger toggle) AND form-initiated (save success, cancel) —
  // must funnel through this handler so `legGroup` gets reset to
  // null. Without the reset, the next open paints `MultiLegFlightForm`
  // with the previous open's segments before the new fetch lands,
  // and the form's drafts state (initialised once via useState) is
  // permanently stuck one save behind the DB.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    const myToken = ++fetchTokenRef.current;
    if (!next) {
      setLegGroup(null);
      setLegGroupError(null);
      return;
    }
    if (!isFlightEdit || !editingSegment) return;
    const seg = editingSegment;
    setLegGroupError(null);
    void loadFlightLegGroupAction(tripId, seg.id).then((result) => {
      if (fetchTokenRef.current !== myToken) return;
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

          Loading state only kicks in for flight edits — the load
          fires conditionally in handleOpenChange. The "Loading…"
          surface stays compact (no skeleton) because the action is
          a single indexed query: typically <100ms on a healthy DB.
        */}
        {isFlightEdit && editingSegment && legGroup === null ? (
          <div className="text-foreground/60 px-1 py-6 text-center text-sm">Loading…</div>
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
