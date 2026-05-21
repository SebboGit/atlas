'use client';

import * as React from 'react';
import { Controller, useWatch } from 'react-hook-form';

import { parseDateString } from '@/components/ui/date-picker';
import { DateTimeField } from '@/components/ui/date-time-field';
import { Label } from '@/components/ui/label';
import { getAirportTimezone } from '@/lib/airports';
import { dateFromLocalInZone, formatLocalDateTimeInZone } from '@/lib/format';
import type { SegmentType } from '@/lib/segments';

import { FieldError, Optional, type Form } from './_helpers';

// Normalises whatever shape the form field is currently holding (Date,
// 'yyyy-mm-dd' string, or 'yyyy-mm-ddThh:mm' string) into the
// combined string the DateTimeField consumes.
//
// `tz` (when provided) is the IANA timezone in which the wall-clock
// should be expressed — used for flights so departure / arrival show
// the airport's local time instead of the user's runtime timezone.
// Without it we fall back to local-tz formatting, which is the right
// choice for hotels / activities / transit (no airport context).
export function toDateTimeValue(d: Date | string | null | undefined, tz: string | null): string {
  if (!d) return '';
  let date: Date;
  if (d instanceof Date) {
    date = d;
  } else {
    // String can be either a wall-clock-in-zone input the user just
    // typed (we re-parse so changes to `tz` reformat the display) or
    // a date-only string. With no tz, just pass through — Zod will
    // do the local-tz parse on submit, same as before.
    if (!tz) return d;
    const parsed = dateFromLocalInZone(d, tz);
    if (!parsed) return '';
    date = parsed;
  }
  if (Number.isNaN(date.getTime())) return '';
  if (tz) return formatLocalDateTimeInZone(date, tz);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) {
    return `${yyyy}-${mm}-${dd}`;
  }
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

// Inverse of toDateTimeValue. With a tz the wall-clock string is
// anchored to that zone and we hand the form a real Date (UTC
// instant). Without a tz we keep the legacy contract — pass the raw
// string through so the Zod validator does the local-tz parse on
// submit.
export function fromDateTimeValue(s: string, tz: string | null): Date | string | null {
  if (!s) return null;
  if (!tz) return s;
  return dateFromLocalInZone(s, tz);
}

function labelsFor(type: SegmentType): { start: string; end: string } {
  switch (type) {
    case 'flight':
      return { start: 'Departure', end: 'Arrival' };
    case 'hotel':
      return { start: 'Check-in', end: 'Check-out' };
    case 'activity':
      return { start: 'Date', end: 'Ends' };
    case 'transit':
      return { start: 'Departure', end: 'Arrival' };
    case 'food':
      // Food is a point in time — a reservation, no end. It renders
      // a start-only row, so there is no end label to surface.
      return { start: 'Reservation', end: '' };
    default:
      return { start: 'Start', end: 'End' };
  }
}

// Placeholder for the optional start field. Activities use an undated
// state as wishlist (ADR-0003), so the copy invites that. Food has no
// wishlist concept — an undated meal just sits undated on the flat
// Food tab — and the "(optional)" label marker already says the field
// can be left empty, so food shows no placeholder at all.
export function startPlaceholderFor(type: SegmentType): string {
  if (type === 'food') return '';
  return 'Leave empty for wishlist';
}

// Whether a segment type renders an end-date field. A food
// reservation is a point in time — a "Reservation" clock time with
// no end — so it shows a start-only row. Every other type keeps the
// start/end pair.
export function hasEndDateField(type: SegmentType): boolean {
  return type !== 'food';
}

export function SharedDateFields({ form, type }: { form: Form; type: SegmentType }) {
  const labels = labelsFor(type);
  const startRaw = useWatch({ control: form.control, name: 'startsAt' });

  // Flight wall-clocks belong at the airport, not at the runtime. We
  // watch the IATA fields the FlightFields module renders and resolve
  // each to an IANA zone. Hotels / activities / transit have no
  // airport context, so they keep the local-tz behaviour by passing
  // null down.
  const originIata = useWatch({
    control: form.control,
    name: 'data.originAirport' as never,
  }) as string | null | undefined;
  const destIata = useWatch({
    control: form.control,
    name: 'data.destinationAirport' as never,
  }) as string | null | undefined;
  const startTz = type === 'flight' ? getAirportTimezone(originIata ?? null) : null;
  const endTz = type === 'flight' ? getAirportTimezone(destIata ?? null) : null;

  // The combined value may carry a time suffix; the calendar only
  // cares about the date prefix so slice it off before parsing.
  const startDateObj = React.useMemo<Date | undefined>(() => {
    if (!startRaw) return undefined;
    if (startRaw instanceof Date) return startRaw;
    return parseDateString(String(startRaw).slice(0, 10));
  }, [startRaw]);

  // Activities and food can both be left undated. Activities use it
  // for wishlist state (ADR-0003); food uses it because the user
  // rarely reserves ahead — undated food is an in-trip shortlist of
  // "maybe" places and lives on the flat Food tab alongside dated
  // reservations.
  const startOptional = type === 'activity' || type === 'food';

  // Time matters for flights, transit, scheduled activities, and
  // food (a restaurant reservation is a specific clock time). Hotels
  // run on property-set check-in times, notes are date-pinned at most.
  const withTime =
    type === 'flight' || type === 'transit' || type === 'activity' || type === 'food';

  // A food reservation is a point in time, not a range — it has a
  // start ("Reservation") and no end. Every other type keeps the
  // two-field start/end layout.
  const hasEnd = hasEndDateField(type);

  return (
    <div className={hasEnd ? 'grid gap-5 sm:grid-cols-2' : 'grid gap-5'}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-start-trigger">
          {labels.start}
          {startOptional && <Optional />}
        </Label>
        <Controller
          control={form.control}
          name="startsAt"
          render={({ field, fieldState }) => (
            <>
              <DateTimeField
                id="seg-start"
                value={toDateTimeValue(field.value as Date | string | null | undefined, startTz)}
                onChange={(s) => field.onChange(fromDateTimeValue(s, startTz))}
                onBlur={field.onBlur}
                name={field.name}
                inputRef={field.ref}
                invalid={!!fieldState.error}
                placeholder={startOptional ? startPlaceholderFor(type) : 'Pick a date'}
                withTime={withTime}
              />
              {fieldState.error?.message && <FieldError>{fieldState.error.message}</FieldError>}
            </>
          )}
        />
      </div>
      {hasEnd && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="seg-end-trigger">
            {labels.end} <Optional />
          </Label>
          <Controller
            control={form.control}
            name="endsAt"
            render={({ field, fieldState }) => (
              <DateTimeField
                id="seg-end"
                value={toDateTimeValue(field.value as Date | string | null | undefined, endTz)}
                onChange={(s) => field.onChange(fromDateTimeValue(s, endTz))}
                onBlur={field.onBlur}
                name={field.name}
                inputRef={field.ref}
                invalid={!!fieldState.error}
                placeholder="—"
                defaultMonth={startDateObj}
                minDate={startDateObj}
                withTime={withTime}
              />
            )}
          />
        </div>
      )}
    </div>
  );
}

// Note's single optional date pin — no time, no end. Lives here
// alongside SharedDateFields so all date-related form UI is in one
// file.
export function NoteDateField({ form }: { form: Form }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="seg-note-date-trigger">
        Pin to a date <Optional />
      </Label>
      <Controller
        control={form.control}
        name="startsAt"
        render={({ field, fieldState }) => (
          <DateTimeField
            id="seg-note-date"
            value={toDateTimeValue(field.value as Date | string | null | undefined, null)}
            onChange={(s) => field.onChange(fromDateTimeValue(s, null))}
            onBlur={field.onBlur}
            name={field.name}
            inputRef={field.ref}
            invalid={!!fieldState.error}
            placeholder="Floating note"
            withTime={false}
          />
        )}
      />
    </div>
  );
}
