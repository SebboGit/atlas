'use client';

import { ChevronDown, MapPin, X } from 'lucide-react';
import * as React from 'react';
import { useFormState, useWatch } from 'react-hook-form';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PlaceCoordsEntry } from '@/lib/geocoding/types';
import { cn } from '@/lib/utils';

import { FieldError, Optional, getDataErrors, type Form } from './_helpers';
import { PlaceFinder } from './place-finder';
import { PlusCodeFields, PlusCodeNudge } from './plus-code-fields';
import {
  endpointEdited,
  endpointPinLine,
  endpointSectionStartsOpen,
  TRANSIT_ENDPOINT_PATHS,
  valueAt,
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

  const [name, address, plusCode] = useWatch({
    control: form.control,
    name: [paths.name, paths.address, paths.plusCode] as never,
  }) as unknown as [unknown, unknown, unknown];
  // Compared against the saved values directly rather than RHF's dirty
  // state, which marks keys the saved data never had ('' vs undefined).
  const saved = form.formState.defaultValues;
  const savedEnd = {
    name: valueAt(saved, paths.name),
    address: valueAt(saved, paths.address),
    plusCode: valueAt(saved, paths.plusCode),
  };
  const edited = endpointEdited({ name, address, plusCode }, savedEnd);

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
  const pin = locate ? endpointPinLine({ name, plusCode, address, located, edited }) : null;
  const sideWord = side === 'from' ? 'origin' : 'destination';

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

      {pin && (
        <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs leading-snug">
          <MapPin
            aria-hidden
            className={cn(
              'size-3.5 shrink-0',
              pin.state === 'pinned' ? 'text-primary' : 'text-foreground/40',
            )}
            strokeWidth={1.75}
          />
          <span className="text-foreground/80 shrink-0 font-mono tracking-wide">{pin.code}</span>
          {pin.detail && <span className="min-w-0 truncate">{pin.detail}</span>}
          {pin.state === 'pinned' && (
            <button
              type="button"
              aria-label={`Clear ${sideWord} pin`}
              onClick={clearPin}
              className="text-foreground/50 hover:text-foreground ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-full [@media(hover:none)]:size-11"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          )}
        </p>
      )}

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
