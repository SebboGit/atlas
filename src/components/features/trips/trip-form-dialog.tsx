'use client';

import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogEyebrow,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createTripAction, updateTripAction, type FormError } from '@/lib/trips/actions';
import type { Trip } from '@/lib/trips';
import type { Result } from '@/types/result';

import { TripForm } from './trip-form';

type CommonProps = {
  // Required when the dialog manages its own open state; optional when
  // driven by `open` + `onOpenChange` from outside (e.g. from a parent
  // DropdownMenu where the menu item is the affordance).
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type CreateProps = CommonProps & {
  mode: 'create';
};

type EditProps = CommonProps & {
  mode: 'edit';
  trip: Trip;
};

export function TripFormDialog(props: CreateProps | EditProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = props.open !== undefined;
  if (isControlled && !props.onOpenChange) {
    throw new Error('TripFormDialog: `onOpenChange` is required when `open` is provided.');
  }
  const open = isControlled ? (props.open ?? false) : internalOpen;
  const setOpen = isControlled ? props.onOpenChange! : setInternalOpen;

  const submit = React.useCallback(
    async (input: unknown): Promise<Result<{ id: string }, FormError>> => {
      if (props.mode === 'edit') {
        return updateTripAction(props.trip.id, input);
      }
      return createTripAction(input);
    },
    [props],
  );

  const headingEyebrow = props.mode === 'edit' ? 'Edit' : 'New';
  const heading = props.mode === 'edit' ? 'Edit trip.' : 'A new trip.';
  const description =
    props.mode === 'edit'
      ? 'Update the details below. Documents and segments stay attached.'
      : 'Give it a name and the dates if you have them. Everything else can come later.';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.trigger && <DialogTrigger asChild>{props.trigger}</DialogTrigger>}
      <DialogContent
        // Radix's default behaviour is to focus the first tabbable
        // element on open (the Title input). On a tall form that
        // scrolls the heading off-screen. Prevent it; users land on
        // the dialog as a whole and can click/tab in.
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Nested Radix popovers (the DatePicker calendar) portal their
        // content OUTSIDE this dialog's DOM. Without this guard, opening
        // the calendar registers as an outside-interaction and closes
        // the whole dialog. Allow the dialog to ignore interactions
        // that originate inside any Radix popper portal.
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest('[data-radix-popper-content-wrapper]')) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="gap-1 sm:gap-2">
          <DialogEyebrow className="hidden sm:flex">
            <span aria-hidden className="bg-foreground/30 h-px w-6" />
            <span>{headingEyebrow} trip</span>
          </DialogEyebrow>
          <DialogTitle className="text-2xl sm:text-3xl">{heading}</DialogTitle>
          <DialogDescription className="hidden sm:block">{description}</DialogDescription>
        </DialogHeader>

        <TripForm
          mode={props.mode}
          initial={props.mode === 'edit' ? props.trip : undefined}
          onSubmit={submit}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
