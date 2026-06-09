'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { FieldError, Optional, getDataErrors, type Form } from './_helpers';
import { PlaceFinder } from './place-finder';
import { PlusCodeFields, PlusCodeNudge } from './plus-code-fields';

export function HotelFields({ form }: { form: Form }) {
  const e = getDataErrors(form.formState.errors);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-property">Property name</Label>
        <Input
          id="seg-property"
          placeholder="Park Hyatt Tokyo"
          aria-invalid={!!e.propertyName || undefined}
          {...form.register('data.propertyName' as never)}
        />
        {e.propertyName?.message && <FieldError>{e.propertyName.message}</FieldError>}
      </div>
      {/* Check-in / check-out times are display-only metadata — shown on
       *  the card and the last-day "Staying" row, but never folded into
       *  the check-in/out DATES below, so they don't affect day ordering.
       *  `min-w-0` lets the native time control shrink inside the grid cell
       *  (iOS Safari won't otherwise — see the dialog-overflow note). */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="seg-checkin-time">
            Check-in time <Optional />
          </Label>
          <Input
            id="seg-checkin-time"
            type="time"
            aria-invalid={!!e.checkInTime || undefined}
            {...form.register('data.checkInTime' as never)}
          />
          {e.checkInTime?.message && <FieldError>{e.checkInTime.message}</FieldError>}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="seg-checkout-time">
            Check-out time <Optional />
          </Label>
          <Input
            id="seg-checkout-time"
            type="time"
            aria-invalid={!!e.checkOutTime || undefined}
            {...form.register('data.checkOutTime' as never)}
          />
          {e.checkOutTime?.message && <FieldError>{e.checkOutTime.message}</FieldError>}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="seg-room">
            Room type <Optional />
          </Label>
          <Input
            id="seg-room"
            placeholder="Park King"
            {...form.register('data.roomType' as never)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="seg-conf">
            Confirmation <Optional />
          </Label>
          <Input
            id="seg-conf"
            placeholder="HX-882421"
            {...form.register('data.confirmationNumber' as never)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-address">
          Address <Optional />
        </Label>
        <Input
          id="seg-address"
          placeholder="3-7-1-2 Nishi-Shinjuku"
          {...form.register('data.address' as never)}
        />
        <PlaceFinder form={form} type="hotel" />
        <PlusCodeNudge form={form} />
      </div>
      <PlusCodeFields form={form} />
    </div>
  );
}
