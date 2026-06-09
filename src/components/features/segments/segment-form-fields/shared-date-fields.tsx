'use client';

import * as React from 'react';
import { Controller, useWatch } from 'react-hook-form';

import { parseDateString } from '@/components/ui/date-picker';
import { DateTimeField } from '@/components/ui/date-time-field';
import { Label } from '@/components/ui/label';
import type { SegmentType } from '@/lib/segments';

import { FieldError, Optional, type Form } from './_helpers';

// Normalises whatever shape the form field is currently holding (Date,
// 'yyyy-mm-dd' string, or 'yyyy-mm-ddThh:mm' string) into the combined
// string the DateTimeField consumes.
//
// Every segment time is floating local — non-flight times under ADR-0014
// and flight times under ADR-0016 — so a stored Date's wall clock is
// read in UTC: the field shows back exactly what was typed and a re-save
// round-trips it unchanged. A string is a wall-clock the user is mid-edit
// on, so it passes straight through. (Flights carry their airport zone as
// a display LABEL on the cards, never as a clock conversion in the form.)
export function toDateTimeValue(d: Date | string | null | undefined): string {
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
    return `${yyyy}-${mm}-${dd}`;
  }
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

// Inverse of toDateTimeValue: hand the form the raw wall-clock string so
// the Zod validator interprets it at UTC on submit (floating local).
export function fromDateTimeValue(s: string): Date | string | null {
  return s || null;
}

export function labelsFor(type: SegmentType): { start: string; end: string } {
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

// Placeholder for the optional start field. Activities and food can both
// be left undated (ADR-0003) and live on their flat tabs alongside dated
// ones. The "(optional)" label marker already says the field can be left
// empty, so neither shows a placeholder.
export function startPlaceholderFor(type: SegmentType): string {
  if (type === 'food' || type === 'activity') return '';
  return 'Pick a date';
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

  // The combined value may carry a time suffix; the calendar only
  // cares about the date prefix so slice it off before parsing.
  const startDateObj = React.useMemo<Date | undefined>(() => {
    if (!startRaw) return undefined;
    if (startRaw instanceof Date) return startRaw;
    return parseDateString(String(startRaw).slice(0, 10));
  }, [startRaw]);

  // Activities and food can both be left undated (ADR-0003) — a
  // candidate the user hasn't pinned to a day yet. Both live on a flat
  // tab where dated and undated entries sit together, and both can be
  // dated later via the quick reschedule dialog.
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
                value={toDateTimeValue(field.value as Date | string | null | undefined)}
                onChange={(s) => field.onChange(fromDateTimeValue(s))}
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
                value={toDateTimeValue(field.value as Date | string | null | undefined)}
                onChange={(s) => field.onChange(fromDateTimeValue(s))}
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
            value={toDateTimeValue(field.value as Date | string | null | undefined)}
            onChange={(s) => field.onChange(fromDateTimeValue(s))}
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
