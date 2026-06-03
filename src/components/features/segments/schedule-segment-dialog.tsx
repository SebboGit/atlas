'use client';

import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { parseDateString } from '@/components/ui/date-picker';
import { DateTimeField } from '@/components/ui/date-time-field';
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
import { scheduleSegmentAction, unscheduleSegmentAction } from '@/lib/segments/actions';

import {
  hasEndDateField,
  labelsFor,
  toDateTimeValue,
} from './segment-form-fields/shared-date-fields';

// The reschedule dialog handles the two schedulable types: activities and
// food. Both can be undated (a candidate the user hasn't pinned to a day)
// and both carry a wall-clock time — a restaurant reservation, an
// activity's start. Other types set their dates only through the full
// edit form.
type SchedulableType = 'activity' | 'food';

interface ScheduleSegmentDialogProps {
  tripId: string;
  segmentId: string;
  segmentType: SchedulableType;
  // null `currentStart` means promoting (undated → dated). A Date means
  // editing the current schedule (and offers a "Clear date" path).
  // `currentEnd` is carried so a reschedule preserves an activity's end
  // instead of dropping it; food has no end.
  currentStart: Date | null;
  currentEnd: Date | null;
  trigger: React.ReactNode;
}

interface FormShape {
  startsAt: string;
  endsAt: string;
}

// Quick date+time editor for an activity / food segment. Promotion (the
// "Schedule" CTA on an undated card) opens it empty; a dated segment
// opens it pre-filled and also gets a "Clear date" button that calls
// unscheduleSegmentAction. Food shows a single "Reservation" field (no
// end); activities show start + optional end. Times are floating local
// (ADR-0014) — the wall-clock typed is stored and shown verbatim, so a
// reschedule never shifts the time.
export function ScheduleSegmentDialog({
  tripId,
  segmentId,
  segmentType,
  currentStart,
  currentEnd,
  trigger,
}: ScheduleSegmentDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const isScheduled = currentStart !== null;
  const hasEnd = hasEndDateField(segmentType);
  const labels = labelsFor(segmentType);

  const form = useForm<FormShape>({
    defaultValues: {
      startsAt: toDateTimeValue(currentStart, null),
      endsAt: hasEnd ? toDateTimeValue(currentEnd, null) : '',
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
    return parseDateString(startRaw.slice(0, 10));
  }, [startRaw]);

  function onSchedule(values: FormShape) {
    setError(null);
    startTransition(async () => {
      const result = await scheduleSegmentAction(tripId, segmentId, {
        startsAt: values.startsAt,
        endsAt: hasEnd ? values.endsAt || null : null,
      });
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Could not save the date.');
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

  function onClear() {
    setError(null);
    startTransition(async () => {
      const result = await unscheduleSegmentAction(tripId, segmentId);
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Could not clear the date.');
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
        <DialogHeader className="gap-1 sm:gap-2">
          <DialogEyebrow className="hidden sm:flex">
            <span aria-hidden className="bg-foreground/30 h-px w-6" />
            <span>{isScheduled ? 'Reschedule' : 'Schedule'}</span>
          </DialogEyebrow>
          <DialogTitle className="text-2xl sm:text-3xl">
            {isScheduled ? 'Change the date.' : 'Pick a date.'}
          </DialogTitle>
          <DialogDescription className="hidden sm:block">
            {isScheduled
              ? 'Change the date or time, or clear it.'
              : 'Once a date is set, this joins the itinerary.'}
          </DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={handleSubmit(onSchedule)} className={dialogScrollContainer}>
          <DialogScrollableBody>
            <div className={hasEnd ? 'grid gap-5 sm:grid-cols-2' : 'grid gap-5'}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="sched-start-trigger">{labels.start}</Label>
                <Controller
                  control={control}
                  name="startsAt"
                  render={({ field, fieldState }) => (
                    <DateTimeField
                      id="sched-start"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      inputRef={field.ref}
                      invalid={!!fieldState.error}
                      placeholder="Pick a date"
                      withTime
                    />
                  )}
                />
                {errors.startsAt?.message && (
                  <p role="alert" className="text-destructive mt-0.5 text-xs leading-snug">
                    {errors.startsAt.message}
                  </p>
                )}
              </div>
              {hasEnd && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sched-end-trigger">
                    {labels.end}{' '}
                    <span className="text-foreground/40 tracking-normal normal-case">
                      {' '}
                      · optional
                    </span>
                  </Label>
                  <Controller
                    control={control}
                    name="endsAt"
                    render={({ field, fieldState }) => (
                      <DateTimeField
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
                        withTime
                      />
                    )}
                  />
                  {errors.endsAt?.message && (
                    <p role="alert" className="text-destructive mt-0.5 text-xs leading-snug">
                      {errors.endsAt.message}
                    </p>
                  )}
                </div>
              )}
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
            {isScheduled && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClear}
                disabled={pending}
                className="text-foreground/65 mr-auto"
              >
                Clear date
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
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogStickyFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
