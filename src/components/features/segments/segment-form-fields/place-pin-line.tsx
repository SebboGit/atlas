'use client';

import { MapPin, X } from 'lucide-react';
import { useWatch } from 'react-hook-form';

import type { PlaceCoordsEntry } from '@/lib/geocoding/types';
import { cn } from '@/lib/utils';

import type { Form } from './_helpers';
import {
  placePinLine,
  placeStillLocated,
  valueAt,
  type PlacePaths,
  type PlacePinLine,
} from './place-pin-logic';

/**
 * One line saying where a place sits on the map — a monospace Plus Code
 * with an optional detail (the address, or the geocoder's city). Shared
 * by the transit From / To blocks and the hotel / food / activity forms
 * so both read the same.
 *
 * `onClear` adds the clear-pin button; it belongs to a `pinned` line
 * only, since a `located` code is display-only and there is nothing
 * stored to clear.
 */
export function PinLine({
  pin,
  onClear,
  clearLabel,
}: {
  pin: PlacePinLine;
  onClear?: () => void;
  clearLabel?: string;
}) {
  return (
    <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs leading-snug">
      <MapPin
        aria-hidden
        className={cn(
          'size-3.5 shrink-0',
          pin.state === 'pinned' ? 'text-primary' : 'text-foreground/40',
        )}
        strokeWidth={1.75}
      />
      {/* The glyph carries the meaning for sighted users; say it for the
          rest, so the line doesn't read as a hint for the field above. */}
      <span className="sr-only">{pin.state === 'pinned' ? 'Pinned at ' : 'Located at '}</span>
      <span className="text-foreground/80 shrink-0 font-mono tracking-wide">{pin.code}</span>
      {pin.detail && <span className="min-w-0 truncate">{pin.detail}</span>}
      {pin.state === 'pinned' && onClear && (
        <button
          type="button"
          aria-label={clearLabel ?? 'Clear pin'}
          onClick={onClear}
          className="text-foreground/50 hover:text-foreground ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-full [@media(hover:none)]:size-11"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </p>
  );
}

/**
 * The "Located" line under a hotel / food / activity Plus Code field:
 * where the saved segment's geocode put this place, shown while nothing
 * that locates it has been edited. Display-only — the code is never
 * written into the form, so renaming the venue or fixing the address
 * still moves the pin (#135).
 *
 * Renders nothing once a Plus Code is in the field: the input above it
 * already shows that code, and the line would only repeat it.
 */
export function PlaceLocatedLine({
  form,
  paths,
  located,
}: {
  form: Form;
  paths: PlacePaths;
  /** Where the saved segment's geocode placed this place, if anywhere. */
  located?: PlaceCoordsEntry | null;
}) {
  const { current, saved } = usePlaceQueryValues(form);
  const pin = placePinLine({
    address: valueAt(current, paths.address),
    plusCode: valueAt(current, paths.plusCode),
    located,
    stillLocated: placeStillLocated(current, saved, 'place'),
  });
  if (pin?.state !== 'located') return null;
  return <PinLine pin={pin} />;
}

/**
 * The form values a geocode query is derived from — as typed, and as the
 * segment was saved. Read straight off `defaultValues` rather than RHF's
 * dirty state, which marks keys the saved data never had ('' vs
 * undefined).
 */
export function usePlaceQueryValues(form: Form): { current: unknown; saved: unknown } {
  const [type, data, locationName, countryCode] = useWatch({
    control: form.control,
    name: ['type', 'data', 'locationName', 'countryCode'] as never,
  }) as unknown as [unknown, unknown, unknown, unknown];
  return {
    current: { type, data, locationName, countryCode },
    saved: form.formState.defaultValues,
  };
}
