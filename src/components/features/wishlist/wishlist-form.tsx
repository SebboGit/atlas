'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { CountrySelect } from '@/components/ui/country-select';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormError } from '@/lib/wishlist/actions';
import {
  WISHLIST_ITEM_TYPES,
  type WishlistItemType,
  wishlistItemCreateInput,
} from '@/lib/wishlist';
import type { Result } from '@/types/result';

import {
  PlusCodeFields,
  PlusCodeNudge,
} from '@/components/features/segments/segment-form-fields/plus-code-fields';
import { TagInput } from './tag-input';

type FormInput = z.input<typeof wishlistItemCreateInput>;
type FormOutput = z.output<typeof wishlistItemCreateInput>;

const TYPE_LABELS: Record<WishlistItemType, string> = {
  food: 'Food',
  activity: 'Activity',
};

interface WishlistFormProps {
  /** When set, the type picker is hidden and the form opens locked. */
  defaultType?: WishlistItemType;
  /** When set, the form opens prefilled and the type picker is locked. */
  initialValues?: FormInput;
  /** Country to prefill when none is in initialValues (suggestion-from-trip flows). */
  defaultCountryCode?: string;
  onSubmit: (input: FormOutput) => Promise<Result<{ id: string }, FormError>>;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

function emptyDataFor(type: WishlistItemType): FormInput['data'] {
  // Mirrors the food/activity segment data shapes exactly; the
  // optional bookingRef stays out of the wishlist form (you don't
  // have a booking until you've added it to a trip and dated it).
  switch (type) {
    case 'food':
      return { venue: '' } as FormInput['data'];
    case 'activity':
      return { title: '' } as FormInput['data'];
  }
}

function FormBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/8 text-destructive rounded-xl border px-4 py-3 text-sm"
    >
      {children}
    </div>
  );
}

function FieldError({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p id={id} role="alert" className="text-destructive mt-0.5 text-xs leading-snug">
      {children}
    </p>
  );
}

function Optional() {
  return <span className="text-foreground/40 tracking-normal normal-case"> · optional</span>;
}

export function WishlistForm({
  defaultType,
  initialValues,
  defaultCountryCode,
  onSubmit,
  onSuccess,
  onCancel,
  submitLabel,
}: WishlistFormProps) {
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const initialType: WishlistItemType = initialValues?.type ?? defaultType ?? 'food';
  const typeLocked = !!initialValues || !!defaultType;

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(wishlistItemCreateInput),
    defaultValues:
      initialValues ??
      ({
        type: initialType,
        data: emptyDataFor(initialType),
        countryCode: defaultCountryCode ?? '',
        locationName: '',
        notes: '',
        tags: [],
      } as FormInput),
  });

  const { register, handleSubmit, setError, setValue, control, formState } = form;
  const errors = formState.errors;
  const currentType = useWatch({ control, name: 'type' }) as WishlistItemType;

  // Reset `data` on type switch so the discriminator's strict() shape
  // doesn't catch a stale field.
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

  type DataErrors = Record<string, { message?: string } | undefined>;
  const dataErrors = (errors.data as DataErrors | undefined) ?? {};

  return (
    // Constrains overall height inside the dialog so the action footer
    // below stays glued to the bottom of the viewport — the form's
    // intrinsic height was pushing Save past the fold on shorter
    // viewports (e.g. ~700px laptops with browser chrome).
    <form
      noValidate
      onSubmit={handleSubmit(submit)}
      className="flex max-h-[calc(85vh-7rem)] flex-col gap-0"
    >
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto pr-1 pb-1">
        {!typeLocked && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="wl-type">Type</Label>
            <Select id="wl-type" {...register('type')}>
              {WISHLIST_ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
        )}

        {currentType === 'food' && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="wl-venue">Restaurant</Label>
              <Input
                id="wl-venue"
                placeholder="Narisawa"
                aria-invalid={!!dataErrors.venue || undefined}
                aria-describedby={dataErrors.venue?.message ? 'wl-venue-error' : undefined}
                {...register('data.venue' as never)}
              />
              {dataErrors.venue?.message && (
                <FieldError id="wl-venue-error">{dataErrors.venue.message}</FieldError>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="wl-food-address">
                Address <Optional />
              </Label>
              <Input
                id="wl-food-address"
                placeholder="2-6-15 Minami-Aoyama, Minato"
                {...register('data.address' as never)}
              />
              <PlusCodeNudge form={form} />
            </div>
            <PlusCodeFields form={form} idPrefix="wl-food" />
          </>
        )}

        {currentType === 'activity' && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="wl-title">Attraction</Label>
              <Input
                id="wl-title"
                placeholder="Senso-ji Temple"
                aria-invalid={!!dataErrors.title || undefined}
                aria-describedby={dataErrors.title?.message ? 'wl-title-error' : undefined}
                {...register('data.title' as never)}
              />
              {dataErrors.title?.message && (
                <FieldError id="wl-title-error">{dataErrors.title.message}</FieldError>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="wl-activity-desc">
                Description <Optional />
              </Label>
              <Input
                id="wl-activity-desc"
                placeholder="Morning visit before crowds"
                {...register('data.description' as never)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="wl-activity-address">
                Address <Optional />
              </Label>
              <Input
                id="wl-activity-address"
                placeholder="6-1-16 Toyosu, Koto"
                {...register('data.address' as never)}
              />
              <PlusCodeNudge form={form} />
            </div>
            <PlusCodeFields form={form} idPrefix="wl-activity" />
          </>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="wl-country">Country</Label>
            <Controller
              control={control}
              name="countryCode"
              render={({ field, fieldState }) => (
                <CountrySelect
                  id="wl-country"
                  name={field.name}
                  value={(field.value as string | null | undefined) ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  invalid={!!fieldState.error}
                />
              )}
            />
            {errors.countryCode?.message && (
              <FieldError id="wl-country-error">{errors.countryCode.message}</FieldError>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="wl-location">
              Area or city <Optional />
            </Label>
            <Input id="wl-location" placeholder="Ginza" {...register('locationName')} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="wl-notes">
            Notes <Optional />
          </Label>
          <Textarea
            id="wl-notes"
            rows={3}
            placeholder="Why you want to come back here…"
            {...register('notes')}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="wl-tags">
            Tags <Optional />
          </Label>
          <Controller
            control={control}
            name="tags"
            render={({ field }) => (
              <TagInput
                id="wl-tags"
                value={(field.value as string[] | undefined) ?? []}
                onChange={field.onChange}
              />
            )}
          />
        </div>

        {formError && <FormBanner>{formError}</FormBanner>}
      </div>

      {/* Sticky action footer — sits at the bottom of the dialog no
       *  matter how tall the field stack grows. Negative margins let
       *  the divider span the full DialogContent width. */}
      <div className="border-foreground/15 bg-card -mx-6 mt-4 -mb-6 flex flex-col-reverse gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
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
