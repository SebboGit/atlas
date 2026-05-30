'use client';

import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TransitData } from '@/lib/segments';

import { FieldError, Optional, getDataErrors, type Form } from './_helpers';
import { PlaceFinder } from './place-finder';
import { PlusCodeFields, PlusCodeNudge } from './plus-code-fields';

// Reuses the Zod-inferred TransitData['mode'] union — no second source
// of truth for the mode literal list.
const TRANSIT_MODES = ['train', 'bus', 'ferry', 'car', 'other'] as const satisfies ReadonlyArray<
  TransitData['mode']
>;

const TRANSIT_MODE_LABELS: Record<TransitData['mode'], string> = {
  train: 'Train',
  bus: 'Bus',
  ferry: 'Ferry',
  car: 'Car',
  other: 'Other',
};

export function TransitFields({ form }: { form: Form }) {
  const e = getDataErrors(form.formState.errors);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="seg-mode">Mode</Label>
          <Select id="seg-mode" {...form.register('data.mode' as never)}>
            {TRANSIT_MODES.map((m) => (
              <option key={m} value={m}>
                {TRANSIT_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="seg-carrier-t">
            Carrier <Optional />
          </Label>
          <Input
            id="seg-carrier-t"
            placeholder="JR East"
            {...form.register('data.carrier' as never)}
          />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="seg-from">From</Label>
          <Input
            id="seg-from"
            placeholder="Tokyo Stn"
            {...form.register('data.fromName' as never)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="seg-to">To</Label>
          <Input
            id="seg-to"
            placeholder="Hakone-Yumoto"
            {...form.register('data.toName' as never)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-transit-address">
          Address <Optional />
        </Label>
        <Input
          id="seg-transit-address"
          placeholder="1-9-1 Marunouchi, Chiyoda"
          {...form.register('data.address' as never)}
        />
        <PlaceFinder form={form} type="transit" />
        <PlusCodeNudge form={form} />
      </div>
      <PlusCodeFields form={form} idPrefix="seg-transit" />
      {e.mode?.message && <FieldError>{e.mode.message}</FieldError>}
    </div>
  );
}
