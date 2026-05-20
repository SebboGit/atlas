'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SEGMENT_TYPES, segmentCreateInput, type SegmentType } from '@/lib/segments';
import type { FormError } from '@/lib/segments/actions';
import type { Result } from '@/types/result';

import { ActivityFields } from './segment-form-fields/activity-fields';
import { CountryFields } from './segment-form-fields/country-fields';
import { FlightFields } from './segment-form-fields/flight-fields';
import { FormBanner, type FormInput, type FormOutput } from './segment-form-fields/_helpers';
import { HotelFields } from './segment-form-fields/hotel-fields';
import { NoteFields } from './segment-form-fields/note-fields';
import { NoteDateField, SharedDateFields } from './segment-form-fields/shared-date-fields';
import { TransitFields } from './segment-form-fields/transit-fields';

const TYPE_LABELS: Record<SegmentType, string> = {
  flight: 'Flight',
  hotel: 'Hotel',
  activity: 'Activity',
  transit: 'Transit',
  note: 'Note',
};

interface SegmentFormProps {
  // When set, the type picker is hidden and that type is enforced
  // (used by tab-scoped "Add flight"/"Add hotel" buttons, and by the
  // edit mode of SegmentFormDialog where changing type post-creation
  // is forbidden).
  defaultType?: SegmentType;
  // Prefill values for edit mode. When set, the form opens populated
  // with the existing segment's data and the type picker is locked
  // (independently of `defaultType` so the call site doesn't have to
  // pass both). Server-side updateSegmentAction additionally rejects
  // a type mismatch as defence in depth.
  initialValues?: FormInput;
  onSubmit: (input: FormOutput) => Promise<Result<{ id: string }, FormError>>;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

// Initial values for the per-type `data` subtree. Reset to this when
// the user switches segment type so stale fields don't leak past
// validation.
function emptyDataFor(type: SegmentType): FormInput['data'] {
  switch (type) {
    case 'flight':
      return {} as FormInput['data'];
    case 'hotel':
      return { propertyName: '' } as FormInput['data'];
    case 'activity':
      return { title: '' } as FormInput['data'];
    case 'transit':
      return { mode: 'train' } as FormInput['data'];
    case 'note':
      return { body: '' } as FormInput['data'];
  }
}

export function SegmentForm({
  defaultType,
  initialValues,
  onSubmit,
  onSuccess,
  onCancel,
  submitLabel,
}: SegmentFormProps) {
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Edit mode (initialValues set) locks the type — changing it after
  // creation is forbidden by the server action. Otherwise, a
  // `defaultType` from a tab-scoped "Add X" button locks it.
  const initialType: SegmentType = initialValues?.type ?? defaultType ?? 'activity';
  const typeLocked = !!initialValues || !!defaultType;

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(segmentCreateInput),
    // Cast: the discriminated-union FormInput narrows `data` based on
    // `type`. RHF's defaultValues type expects an exact variant, but
    // we set type + data together so the shape is correct at runtime.
    defaultValues:
      initialValues ??
      ({
        type: initialType,
        data: emptyDataFor(initialType),
        startsAt: '',
        endsAt: '',
        locationName: '',
        countryCode: '',
        originCountryCode: '',
      } as FormInput),
  });

  const { register, handleSubmit, setError, setValue, control } = form;

  const currentType = useWatch({ control, name: 'type' }) as SegmentType;

  // Reset `data` whenever the discriminator changes. Without this, a
  // hidden carry-over (e.g. propertyName from a previous hotel pick)
  // would fail the new branch's strict-data validation.
  //
  // Country / location are *not* cleared on switch — the validator
  // strips them per-variant (validators.ts), so they can survive a
  // round-trip through note and reappear if the user changes their
  // mind back to flight.
  const prevTypeRef = React.useRef(initialType);
  React.useEffect(() => {
    if (prevTypeRef.current === currentType) return;
    prevTypeRef.current = currentType;
    setValue('data', emptyDataFor(currentType), {
      shouldDirty: false,
      shouldValidate: false,
    });
  }, [currentType, setValue]);

  function applyServerErrors(error: FormError) {
    setFormError(error.formMessage ?? null);
    if (!error.fields) return;
    for (const [name, message] of Object.entries(error.fields)) {
      setError(name as keyof FormInput, { type: 'server', message });
    }
  }

  function submit(values: FormOutput) {
    setFormError(null);
    startTransition(async () => {
      const result = await onSubmit(values);
      if (result.ok) onSuccess?.(result.value.id);
      else applyServerErrors(result.error);
    });
  }

  return (
    <form noValidate onSubmit={handleSubmit(submit)} className="flex flex-col gap-5">
      {!typeLocked && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="seg-type">Type</Label>
          <Select id="seg-type" {...register('type')}>
            {SEGMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
      )}

      {currentType === 'flight' && <FlightFields form={form} />}
      {currentType === 'hotel' && <HotelFields form={form} />}
      {currentType === 'activity' && <ActivityFields form={form} />}
      {currentType === 'transit' && <TransitFields form={form} />}
      {currentType === 'note' && <NoteFields form={form} />}

      {currentType !== 'note' && <SharedDateFields form={form} type={currentType} />}
      {currentType === 'note' && <NoteDateField form={form} />}

      <CountryFields form={form} type={currentType} />

      {formError && <FormBanner>{formError}</FormBanner>}

      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : (submitLabel ?? `Add ${TYPE_LABELS[currentType].toLowerCase()}`)}
        </Button>
      </div>
    </form>
  );
}
