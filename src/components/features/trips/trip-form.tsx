'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { DatePicker, parseDateString } from '@/components/ui/date-picker';
import {
  DialogScrollableBody,
  DialogStickyFooter,
  dialogScrollContainer,
} from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormError } from '@/lib/trips/actions';
import {
  TRIP_STATUSES,
  TRIP_VISIBILITIES,
  tripCreateInput,
  type Trip,
  type TripStatus,
  type TripVisibility,
} from '@/lib/trips';
import type { Result } from '@/types/result';

// The Zod schema transforms (string → Date | null, '' → null), so its
// input and output types differ. RHF needs both: input shape for
// register/defaultValues, output shape for resolver result.
type FormInput = z.input<typeof tripCreateInput>;
type FormOutput = z.output<typeof tripCreateInput>;

const STATUS_LABELS: Record<TripStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

const VISIBILITY_LABELS: Record<TripVisibility, string> = {
  household: 'Household — shared',
  private: 'Private — only me',
};

type Submitter = (input: FormOutput) => Promise<Result<{ id: string }, FormError>>;

interface TripFormProps {
  mode: 'create' | 'edit';
  initial?: Trip;
  onSubmit: Submitter;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}

// `yyyy-mm-dd` is the value shape native <input type="date"> expects.
function toDateInputValue(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function TripForm({ mode, initial, onSubmit, onSuccess, onCancel }: TripFormProps) {
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(tripCreateInput),
    defaultValues: {
      title: initial?.title ?? '',
      summary: initial?.summary ?? '',
      status: initial?.status ?? 'planned',
      visibility: initial?.visibility ?? 'household',
      startDate: toDateInputValue(initial?.startDate),
      endDate: toDateInputValue(initial?.endDate),
    },
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = form;

  // Watch the start date so the end picker can open at the right
  // month and disable earlier days. useWatch re-renders just this
  // subtree, not the whole form.
  const startRaw = useWatch({ control: form.control, name: 'startDate' });
  const startDateObj = React.useMemo<Date | undefined>(() => {
    if (!startRaw) return undefined;
    if (startRaw instanceof Date) return startRaw;
    return parseDateString(startRaw);
  }, [startRaw]);

  function applyServerErrors(error: FormError) {
    setFormError(error.formMessage ?? null);
    if (error.fields) {
      for (const [name, message] of Object.entries(error.fields)) {
        if (name in form.getValues()) {
          setError(name as keyof FormInput, { type: 'server', message });
        }
      }
    }
  }

  function submit(values: FormOutput) {
    setFormError(null);
    startTransition(async () => {
      const result = await onSubmit(values);
      if (result.ok) {
        onSuccess?.(result.value.id);
      } else {
        applyServerErrors(result.error);
      }
    });
  }

  const submitLabel = mode === 'create' ? 'Add trip' : 'Save changes';
  const titleErr = errors.title?.message;
  const summaryErr = errors.summary?.message;
  const startErr = errors.startDate?.message;
  const endErr = errors.endDate?.message;

  return (
    <form noValidate onSubmit={handleSubmit(submit)} className={dialogScrollContainer}>
      <DialogScrollableBody>
        <div className="flex flex-col gap-2">
          <Label htmlFor="trip-title">Title</Label>
          {/* No autoFocus: in a scrollable dialog, focusing this input would scroll
            the heading off-screen on initial open. Users can click or tab in. */}
          <Input
            id="trip-title"
            aria-invalid={!!titleErr || undefined}
            autoComplete="off"
            placeholder="Lisbon weekend"
            {...register('title')}
          />
          {titleErr && <FieldError>{titleErr}</FieldError>}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="trip-summary">
            Summary{' '}
            <span className="text-foreground/40 tracking-normal normal-case"> · optional</span>
          </Label>
          <Textarea
            id="trip-summary"
            rows={4}
            aria-invalid={!!summaryErr || undefined}
            placeholder="A long weekend tracing tilework and pastries."
            {...register('summary')}
          />
          {summaryErr && <FieldError>{summaryErr}</FieldError>}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="trip-start-trigger">Start</Label>
            <Controller
              control={form.control}
              name="startDate"
              render={({ field, fieldState }) => (
                <DatePicker
                  id="trip-start"
                  value={toDateInputValue(field.value)}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  inputRef={field.ref}
                  invalid={!!fieldState.error}
                  placeholder="Pick a start date"
                />
              )}
            />
            {startErr && <FieldError>{startErr}</FieldError>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="trip-end-trigger">End</Label>
            <Controller
              control={form.control}
              name="endDate"
              render={({ field, fieldState }) => (
                <DatePicker
                  id="trip-end"
                  value={toDateInputValue(field.value)}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  inputRef={field.ref}
                  invalid={!!fieldState.error}
                  placeholder="Pick an end date"
                  defaultMonth={startDateObj}
                  minDate={startDateObj}
                />
              )}
            />
            {endErr && <FieldError>{endErr}</FieldError>}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="trip-status">Status</Label>
            <Select id="trip-status" {...register('status')}>
              {TRIP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="trip-visibility">Visibility</Label>
            <Select id="trip-visibility" {...register('visibility')}>
              {TRIP_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABELS[v]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {formError && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/8 text-destructive rounded-xl border px-4 py-3 text-sm"
          >
            {formError}
          </div>
        )}
      </DialogScrollableBody>

      <DialogStickyFooter>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </DialogStickyFooter>
    </form>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-destructive mt-0.5 text-xs leading-snug">
      {children}
    </p>
  );
}
