'use client';

import * as React from 'react';

import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';

interface DateTimeFieldProps {
  /**
   * Combined value: either `yyyy-mm-dd` (date only) or
   * `yyyy-mm-ddThh:mm` (date + time). Empty string means unset.
   */
  value: string;
  onChange: (next: string) => void;
  /** When true, render a paired time input. */
  withTime: boolean;
  id?: string;
  name?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  inputRef?: React.Ref<HTMLInputElement>;
  invalid?: boolean;
  placeholder?: string;
  defaultMonth?: Date;
  minDate?: Date;
}

// Composes the Atlas DatePicker with a native time input to capture a
// combined timestamp. The two halves share one form-state slot so RHF
// + Zod see a single field. Time without date is meaningless, so the
// time input is disabled until a date is picked.
//
// Value contract — single string:
//   ''                         → unset
//   '2026-06-12'               → date only
//   '2026-06-12T10:40'         → date + time (local)
//
// The Zod dateInput validator parses both formats via `new Date()`
// so no schema change is required.
export function DateTimeField({
  value,
  onChange,
  withTime,
  id,
  name,
  onBlur,
  inputRef,
  invalid,
  placeholder,
  defaultMonth,
  minDate,
}: DateTimeFieldProps) {
  const [datePart, timePart] = React.useMemo(() => {
    if (!value) return ['', ''] as const;
    const i = value.indexOf('T');
    if (i === -1) return [value, ''] as const;
    return [value.slice(0, i), value.slice(i + 1, i + 6)] as const; // hh:mm
  }, [value]);

  const setDate = (next: string) => {
    if (!next) {
      onChange('');
      return;
    }
    onChange(timePart ? `${next}T${timePart}` : next);
  };

  const setTime = (raw: string) => {
    if (!datePart) return;
    const next = raw.slice(0, 5); // hh:mm
    onChange(next ? `${datePart}T${next}` : datePart);
  };

  if (!withTime) {
    return (
      <DatePicker
        id={id}
        name={name}
        value={datePart}
        onChange={setDate}
        onBlur={onBlur}
        inputRef={inputRef}
        invalid={invalid}
        placeholder={placeholder}
        defaultMonth={defaultMonth}
        minDate={minDate}
      />
    );
  }

  return (
    // `min-w-0` on each flex child is critical: without it, the date
    // trigger's `truncate` text doesn't actually shrink in a flex
    // container (default `min-width: auto` keeps flex items at their
    // intrinsic content size), so the time picker overflows the column
    // and lands on top of the next field — or off the dialog edge.
    <div className="flex items-stretch gap-2">
      <div className="min-w-0 flex-1">
        <DatePicker
          id={id}
          name={name}
          value={datePart}
          onChange={setDate}
          onBlur={onBlur}
          inputRef={inputRef}
          invalid={invalid}
          placeholder={placeholder}
          defaultMonth={defaultMonth}
          minDate={minDate}
        />
      </div>
      {/* 7rem covers the worst-case mobile rendering of `<input
          type="time">` — on Android Chrome the native field reserves
          ~24px for its clock glyph plus the Input's px-4 padding (32px
          total), leaving ~56px for the value text. At the previous
          5.5rem that wasn't enough for "15:00" at text-[15px] and the
          last digit visibly clipped. The desktop popover trigger
          inherits w-full so it widens harmlessly. */}
      <div className="w-28 shrink-0">
        <TimePicker value={timePart} onChange={setTime} disabled={!datePart} invalid={invalid} />
      </div>
    </div>
  );
}
