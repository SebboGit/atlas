'use client';

import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { DatePicker, parseDateString, toDateString } from '@/components/ui/date-picker';
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
import { Label } from '@/components/ui/label';
import { scheduleActivityAction, unscheduleActivityAction } from '@/lib/segments/actions';

interface ScheduleActivityDialogProps {
  tripId: string;
  segmentId: string;
  // null/undefined means promoting (wishlist → scheduled). A Date means
  // editing the currently-scheduled date (and offers an "unschedule"
  // path).
  currentStart: Date | null;
  trigger: React.ReactNode;
}

interface FormShape {
  startsAt: string;
  endsAt: string;
}

function toDateInputValue(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  // Use the same local-time formatter the DatePicker parses with
  // (date-picker.tsx#toDateString). Mixing UTC formatting with local
  // parsing put scheduled activities on the wrong wall-clock day for
  // anyone whose timezone wasn't UTC.
  return toDateString(date);
}

// Tiny dialog with just a date picker (and an optional end date).
// Wishlist promotion ("Schedule" CTA on a wishlist card) opens it with
// no current value; a scheduled activity opens it pre-filled and also
// gets a "Move to wishlist" button that calls unscheduleActivityAction.
export function ScheduleActivityDialog({
  tripId,
  segmentId,
  currentStart,
  trigger,
}: ScheduleActivityDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const isScheduled = currentStart !== null;

  const form = useForm<FormShape>({
    defaultValues: {
      startsAt: toDateInputValue(currentStart),
      endsAt: '',
    },
  });
  const {
    handleSubmit,
    control,
    setError: setFieldError,
    formState: { errors },
  } = form;

  const startRaw = useWatch({ control, name: 'startsAt' });
  const startDateObj = React.useMemo<Date | undefined>(() => {
    if (!startRaw) return undefined;
    return parseDateString(startRaw);
  }, [startRaw]);

  function onSchedule(values: FormShape) {
    setError(null);
    startTransition(async () => {
      const result = await scheduleActivityAction(tripId, segmentId, {
        startsAt: values.startsAt,
        endsAt: values.endsAt || null,
      });
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Could not schedule activity.');
        if (result.error.fields?.startsAt) {
          setFieldError('startsAt', { type: 'server', message: result.error.fields.startsAt });
        }
        if (result.error.fields?.endsAt) {
          setFieldError('endsAt', { type: 'server', message: result.error.fields.endsAt });
        }
        return;
      }
      setOpen(false);
    });
  }

  function onUnschedule() {
    setError(null);
    startTransition(async () => {
      const result = await unscheduleActivityAction(tripId, segmentId);
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Could not move to wishlist.');
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest('[data-radix-popper-content-wrapper]')) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogEyebrow>
            <span aria-hidden className="bg-foreground/30 h-px w-6" />
            <span>{isScheduled ? 'Reschedule' : 'Schedule'}</span>
          </DialogEyebrow>
          <DialogTitle>{isScheduled ? 'Move this activity.' : 'Pick a date.'}</DialogTitle>
          <DialogDescription>
            {isScheduled
              ? 'Change the date, or move it back to the wishlist.'
              : 'Once a date is set, this activity joins the itinerary.'}
          </DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={handleSubmit(onSchedule)} className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sched-start-trigger">Date</Label>
              <Controller
                control={control}
                name="startsAt"
                render={({ field, fieldState }) => (
                  <DatePicker
                    id="sched-start"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    inputRef={field.ref}
                    invalid={!!fieldState.error}
                    placeholder="Pick a date"
                  />
                )}
              />
              {errors.startsAt?.message && (
                <p role="alert" className="text-destructive mt-0.5 text-xs leading-snug">
                  {errors.startsAt.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sched-end-trigger">
                Ends{' '}
                <span className="text-foreground/40 tracking-normal normal-case"> · optional</span>
              </Label>
              <Controller
                control={control}
                name="endsAt"
                render={({ field, fieldState }) => (
                  <DatePicker
                    id="sched-end"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    inputRef={field.ref}
                    invalid={!!fieldState.error}
                    placeholder="—"
                    defaultMonth={startDateObj}
                    minDate={startDateObj}
                  />
                )}
              />
              {errors.endsAt?.message && (
                <p role="alert" className="text-destructive mt-0.5 text-xs leading-snug">
                  {errors.endsAt.message}
                </p>
              )}
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/8 text-destructive rounded-xl border px-4 py-3 text-sm"
            >
              {error}
            </div>
          )}

          <DialogFooter>
            {isScheduled && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onUnschedule}
                disabled={pending}
                className="text-foreground/65 mr-auto"
              >
                Move to wishlist
              </Button>
            )}
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
              {pending ? 'Saving…' : isScheduled ? 'Save' : 'Schedule it'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
