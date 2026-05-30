'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { FieldError, Optional, getDataErrors, type Form } from './_helpers';
import { PlaceFinder } from './place-finder';
import { PlusCodeFields, PlusCodeNudge } from './plus-code-fields';

// Food-segment fields. Deliberately light per the food-segment-type
// design: the venue name, an optional address, and an optional
// booking reference. The address mirrors the hotel form's address
// field — it gives the geocoder a reliable signal when a restaurant
// doesn't resolve by name alone. The reservation time is the shared
// `startsAt` date field (rendered by SharedDateFields), so it isn't
// repeated here.
export function FoodFields({ form }: { form: Form }) {
  const e = getDataErrors(form.formState.errors);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-venue">Venue</Label>
        <Input
          id="seg-venue"
          placeholder="Narisawa"
          aria-invalid={!!e.venue || undefined}
          {...form.register('data.venue' as never)}
        />
        {e.venue?.message && <FieldError>{e.venue.message}</FieldError>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-food-address">
          Address <Optional />
        </Label>
        <Input
          id="seg-food-address"
          placeholder="2-6-15 Minami-Aoyama, Minato"
          {...form.register('data.address' as never)}
        />
        <PlaceFinder form={form} type="food" />
        <PlusCodeNudge form={form} />
      </div>
      <PlusCodeFields form={form} idPrefix="seg-food" />
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-food-ref">
          Booking reference <Optional />
        </Label>
        <Input
          id="seg-food-ref"
          placeholder="OT-4821"
          {...form.register('data.bookingRef' as never)}
        />
      </div>
    </div>
  );
}
