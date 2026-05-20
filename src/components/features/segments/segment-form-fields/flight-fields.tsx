'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { FieldError, Optional, getDataErrors, type Form } from './_helpers';

export function FlightFields({ form }: { form: Form }) {
  const e = getDataErrors(form.formState.errors);
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-origin">From (IATA)</Label>
        <Input
          id="seg-origin"
          placeholder="LHR"
          maxLength={3}
          aria-invalid={!!e.originAirport || undefined}
          {...form.register('data.originAirport' as never)}
        />
        {e.originAirport?.message && <FieldError>{e.originAirport.message}</FieldError>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-destination">To (IATA)</Label>
        <Input
          id="seg-destination"
          placeholder="HND"
          maxLength={3}
          aria-invalid={!!e.destinationAirport || undefined}
          {...form.register('data.destinationAirport' as never)}
        />
        {e.destinationAirport?.message && <FieldError>{e.destinationAirport.message}</FieldError>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-carrier">
          Carrier <Optional />
        </Label>
        <Input
          id="seg-carrier"
          placeholder="British Airways"
          {...form.register('data.carrier' as never)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-flight-no">
          Flight no. <Optional />
        </Label>
        <Input
          id="seg-flight-no"
          placeholder="BA 5"
          {...form.register('data.flightNumber' as never)}
        />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="seg-pnr">
          PNR <Optional />
        </Label>
        <Input id="seg-pnr" placeholder="ABC123" {...form.register('data.pnr' as never)} />
      </div>
    </div>
  );
}
