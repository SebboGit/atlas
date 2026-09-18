'use client';

import { ChevronDown } from 'lucide-react';
import * as React from 'react';
import { useFormState } from 'react-hook-form';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PlaceCoordsEntry } from '@/lib/geocoding/types';
import { cn } from '@/lib/utils';

import { FieldError, Optional, getDataErrors, type Form } from './_helpers';
import { PlaceFinder } from './place-finder';
import { PinLine, usePlaceQueryValues } from './place-pin-line';
import { placePinLine, placeStillLocated, placeValuesAt, valueAt } from './place-pin-logic';
import { PlusCodeFields, PlusCodeNudge } from './plus-code-fields';
import {
  endpointSectionStartsOpen,
  TRANSIT_ENDPOINT_PATHS,
  type EndpointSide,
} from './transit-endpoint-logic';

const COPY: Record<
  EndpointSide,
  { label: string; namePlaceholder: string; addressPlaceholder: string }
> = {
  from: {
    label: 'From',
    namePlaceholder: 'Tokyo Stn',
    addressPlaceholder: '1-9-1 Marunouchi, Chiyoda',
  },
  to: { label: 'To', namePlaceholder: 'Hakone-Yumoto', addressPlaceholder: '707-1 Yumoto, Hakone' },
};

interface TransitEndpointFieldsProps {
  form: Form;
  side: EndpointSide;
  /**
   * Offer Find, the pin line and the address / Plus Code section. Off for
   * a car / other origin, which is a name only (ADR-0019).
   */
  locate: boolean;
  /** Where the saved segment's geocode placed this end, if anywhere. */
  located?: PlaceCoordsEntry | null;
}

// One end of a transit leg: its name with Find beside it, a line saying
// where the end sits on the map, and a collapsed "Address · Plus Code"
// section for precise entry.
export function TransitEndpointFields({ form, side, locate, located }: TransitEndpointFieldsProps) {
  const paths = TRANSIT_ENDPOINT_PATHS[side];
  const copy = COPY[side];
  const idBase = `seg-transit-${side}`;
  const regionId = React.useId();

  const savedEnd = placeValuesAt(form.formState.defaultValues, paths);

  const formState = useFormState({ control: form.control });
  const errors = getDataErrors(formState.errors);
  const addressError = errors[paths.address.replace(/^data\./, '')]?.message;
  const hasLocationError =
    !!addressError || !!errors[paths.plusCode.replace(/^data\./, '')]?.message;

  // A car / other origin hides its location fields, but a value kept from
  // a train that fails validation must stay reachable — otherwise Save
  // silently does nothing.
  const showLocation = locate || hasLocationError;
  const [sectionOpen, setSectionOpen] = React.useState(() => endpointSectionStartsOpen(savedEnd));
  const expanded = showLocation && (sectionOpen || hasLocationError);

  function clearPin() {
    for (const path of [paths.plusCode, paths.address]) {
      form.setValue(path as never, '' as never, { shouldDirty: true, shouldValidate: true });
    }
    // The button unmounts with the pin line; keep focus on this end.
    form.setFocus(paths.name as never);
  }

  const labelId = `${idBase}-label`;
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
      <Label id={labelId} htmlFor={`${idBase}-name`}>
        {copy.label}
      </Label>
      <div className="flex items-start gap-2">
        <Input
          id={`${idBase}-name`}
          placeholder={copy.namePlaceholder}
          className="min-w-0 flex-1"
          {...form.register(paths.name as never)}
        />
        {locate && (
          <PlaceFinder
            form={form}
            type="transit"
            paths={paths}
            side={side}
            // The segment's one country is its destination's (ADR-0005).
            fillCountry={side === 'to'}
            compact
          />
        )}
      </div>

      {locate && <TransitPinLine form={form} side={side} located={located} onClear={clearPin} />}

      {showLocation && (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={regionId}
            onClick={() => setSectionOpen(!expanded)}
            className="text-foreground/70 hover:text-foreground inline-flex items-center gap-1.5 self-start font-mono text-[10px] tracking-[0.2em] uppercase [@media(hover:none)]:min-h-11"
          >
            <ChevronDown
              aria-hidden
              className={cn(
                'size-3.5 transition-transform duration-150',
                !expanded && '-rotate-90',
              )}
            />
            <span className="sr-only">{copy.label} </span>
            Address · Plus Code
          </button>
          <div id={regionId} hidden={!expanded} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idBase}-address`}>
                Address <Optional />
              </Label>
              <Input
                id={`${idBase}-address`}
                placeholder={copy.addressPlaceholder}
                aria-invalid={!!addressError || undefined}
                {...form.register(paths.address as never)}
              />
              {addressError && <FieldError>{addressError}</FieldError>}
              <PlusCodeNudge
                form={form}
                addressPath={paths.address}
                plusCodePath={paths.plusCode}
              />
            </div>
            <PlusCodeFields form={form} idPrefix={idBase} path={paths.plusCode} />
          </div>
        </>
      )}
    </div>
  );
}

// The pin line for one end, as its own leaf: it watches the whole `data`
// subtree (a station key reads more than the three fields beside it), and
// keeping that subscription down here means a keystroke in either end
// re-renders this line rather than both endpoint blocks.
function TransitPinLine({
  form,
  side,
  located,
  onClear,
}: {
  form: Form;
  side: EndpointSide;
  located?: PlaceCoordsEntry | null;
  onClear: () => void;
}) {
  const paths = TRANSIT_ENDPOINT_PATHS[side];
  const { current, saved } = usePlaceQueryValues(form);
  // Query equality, per end: a route-label (locationName) edit leaves a
  // station key alone, a renamed station doesn't (ADR-0019).
  const pin = placePinLine({
    address: valueAt(current, paths.address),
    plusCode: valueAt(current, paths.plusCode),
    located,
    stillLocated: placeStillLocated(current, saved, side === 'from' ? 'origin' : 'destination'),
  });
  if (!pin) return null;
  const sideWord = side === 'from' ? 'origin' : 'destination';
  return <PinLine pin={pin} onClear={onClear} clearLabel={`Clear ${sideWord} pin`} />;
}
