'use client';

import { useWatch } from 'react-hook-form';

import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PlaceCoordsEntry } from '@/lib/geocoding/types';
import { hasTransitEndpoints, type TransitData } from '@/lib/segments';

import { FieldError, Optional, getDataErrors, type Form } from './_helpers';
import { TransitEndpointFields } from './transit-endpoint-fields';

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

export function TransitFields({
  form,
  coords,
}: {
  form: Form;
  /** The saved segment's coordinates, for the From / To pin lines. */
  coords?: PlaceCoordsEntry | null;
}) {
  const e = getDataErrors(form.formState.errors);
  const mode = useWatch({ control: form.control, name: 'data.mode' as never }) as unknown;
  // Train / bus / ferry locate both ends (ADR-0019); car / other keep a
  // name-only From and a located To. From values survive a switch to car
  // (ignored there) so switching back restores them.
  const endpointMode = hasTransitEndpoints(mode);
  return (
    <div className="flex flex-col gap-5">
      {/* [&>*]:min-w-0 — the Mode field is a native <select>, which iOS
          won't shrink below its widest option; same guard as the trip
          form's status/visibility row. */}
      <div className="grid gap-5 sm:grid-cols-2 [&>*]:min-w-0">
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
      {/* Side by side from sm:, stacked on phone. min-w-0 lets the name
          inputs shrink beside their Find buttons instead of overflowing. */}
      <div className="grid gap-5 sm:grid-cols-2 sm:items-start [&>*]:min-w-0">
        <TransitEndpointFields
          form={form}
          side="from"
          locate={endpointMode}
          located={endpointMode ? coords?.endpoints?.origin : null}
        />
        <TransitEndpointFields
          form={form}
          side="to"
          locate
          located={endpointMode ? coords?.endpoints?.destination : coords}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-transit-ref">
          Reference <Optional />
        </Label>
        <Input
          id="seg-transit-ref"
          placeholder="KX-20931"
          {...form.register('data.referenceNumber' as never)}
        />
      </div>
      {e.mode?.message && <FieldError>{e.mode.message}</FieldError>}
    </div>
  );
}
