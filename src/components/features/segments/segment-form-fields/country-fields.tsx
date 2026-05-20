'use client';

import * as React from 'react';
import { Controller, useWatch } from 'react-hook-form';

import { CountrySelect } from '@/components/ui/country-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAirportCountry } from '@/lib/airports';
import type { SegmentType } from '@/lib/segments';

import { Optional, type Form } from './_helpers';

// Geography fields. Notes have no place — they're rendered nowhere on
// the note variant. Flights get two countries (origin + destination).
// Hotels / activities / transit get one country + a free-text
// location name.
export function CountryFields({ form, type }: { form: Form; type: SegmentType }) {
  if (type === 'note') return null;

  // For flights the row reads origin → destination (left → right),
  // mirroring the FROM (IATA) → TO (IATA) row above so the eye can
  // follow the journey across the form. For hotels / activities /
  // transit there's one country, with the free-text location name on
  // the right.
  if (type === 'flight') {
    return <FlightCountryFields form={form} />;
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-country">
          Country <Optional />
        </Label>
        <Controller
          control={form.control}
          name="countryCode"
          render={({ field, fieldState }) => (
            <CountrySelect
              id="seg-country"
              name={field.name}
              value={(field.value as string | null | undefined) ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              invalid={!!fieldState.error}
            />
          )}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-location">
          Location name <Optional />
        </Label>
        <Input
          id="seg-location"
          placeholder={type === 'hotel' ? 'Shinjuku' : 'Toyosu'}
          {...form.register('locationName' as never)}
        />
      </div>
    </div>
  );
}

// Flight variant: two country dropdowns that auto-fill from the IATA
// codes typed into the FROM / TO inputs above. We never overwrite a
// country the user has set themselves — see useAirportCountryAutofill
// for the "did the user touch this?" rule.
function FlightCountryFields({ form }: { form: Form }) {
  useAirportCountryAutofill({
    form,
    iataField: 'data.originAirport',
    countryField: 'originCountryCode',
  });
  useAirportCountryAutofill({
    form,
    iataField: 'data.destinationAirport',
    countryField: 'countryCode',
  });

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-origin-country">
          Origin country <Optional />
        </Label>
        <Controller
          control={form.control}
          name="originCountryCode"
          render={({ field, fieldState }) => (
            <CountrySelect
              id="seg-origin-country"
              name={field.name}
              value={(field.value as string | null | undefined) ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              invalid={!!fieldState.error}
            />
          )}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-country">
          Destination country <Optional />
        </Label>
        <Controller
          control={form.control}
          name="countryCode"
          render={({ field, fieldState }) => (
            <CountrySelect
              id="seg-country"
              name={field.name}
              value={(field.value as string | null | undefined) ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              invalid={!!fieldState.error}
            />
          )}
        />
      </div>
    </div>
  );
}

// Watches an IATA field and keeps the matching country dropdown in
// sync. IATA is treated as canonical: whenever the field resolves to
// a known airport, the country snaps to that airport's country. A
// partially-typed or unrecognised IATA leaves the country untouched
// so we don't blank out a meaningful value mid-keystroke.
function useAirportCountryAutofill({
  form,
  iataField,
  countryField,
}: {
  form: Form;
  iataField: 'data.originAirport' | 'data.destinationAirport';
  countryField: 'originCountryCode' | 'countryCode';
}): void {
  const iata = useWatch({ control: form.control, name: iataField as never }) as
    | string
    | null
    | undefined;

  React.useEffect(() => {
    const resolved = getAirportCountry(iata ?? null);
    if (!resolved) return;
    const current = form.getValues(countryField as never) as unknown as string | null | undefined;
    if (current === resolved) return;
    form.setValue(countryField as never, resolved as never, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });
  }, [iata, form, countryField]);
}
