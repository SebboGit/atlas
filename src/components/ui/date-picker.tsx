'use client';

import { Calendar as CalendarIcon } from 'lucide-react';
import * as React from 'react';

import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  /** yyyy-mm-dd string, or '' when empty. */
  value: string;
  onChange: (next: string) => void;
  id?: string;
  /** Forwarded to both the native input and the custom trigger. */
  invalid?: boolean;
  /** Display-only label shown inside the custom trigger when empty. */
  placeholder?: string;
  /** Optional ref so RHF's register can target the native input. */
  inputRef?: React.Ref<HTMLInputElement>;
  /** Forwarded to the native input (e.g. for register's onBlur). */
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  name?: string;
  className?: string;
  /**
   * Month to show when the picker opens with no value yet. Useful for
   * paired pickers (end-of-range follows start-of-range).
   */
  defaultMonth?: Date;
  /**
   * Earliest selectable date. Disables earlier days in the custom
   * calendar and sets `min` on the native input.
   */
  minDate?: Date;
}

// yyyy-mm-dd ↔ Date helpers. We work in local time on the parse step
// (no UTC offset surprises) but always emit the yyyy-mm-dd form, so the
// Zod schema's `new Date(string)` parser yields the same calendar day.
export function parseDateString(s: string): Date | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDisplay(s: string): string {
  const d = parseDateString(s);
  if (!d) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Responsive DatePicker.
 *
 * Touch devices (pointer:coarse): native `<input type="date">`. Best
 * accessibility, native wheels, no JS needed for the picker itself.
 *
 * Pointer devices (pointer:fine): custom popover with an Atlas-skinned
 * calendar grid. Same data shape, same Zod validation — just a nicer
 * visual on laptop / desktop.
 *
 * Both representations are mounted; CSS hides the wrong one for the
 * device. No `useMediaQuery` round-trip on hydrate, no flash.
 */
export function DatePicker({
  value,
  onChange,
  id,
  invalid,
  placeholder = 'Pick a date',
  inputRef,
  onBlur,
  name,
  className,
  defaultMonth,
  minDate,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = parseDateString(value);
  const minString = minDate ? toDateString(minDate) : undefined;

  return (
    <div className={cn('relative', className)}>
      {/* Native — visible only on coarse pointer (touch). */}
      <Input
        id={id}
        ref={inputRef}
        name={name}
        type="date"
        value={value}
        min={minString}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid || undefined}
        className="[@media(pointer:fine)]:hidden"
      />

      {/* Custom — visible only on fine pointer (mouse / trackpad / pen). */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id ? `${id}-trigger` : undefined}
            data-invalid={invalid || undefined}
            aria-haspopup="dialog"
            className={cn(
              'hidden [@media(pointer:fine)]:flex',
              // Match Input visuals so the form reads as one consistent surface.
              'border-foreground/15 bg-card/70 h-11 w-full items-center justify-between rounded-xl border px-4 text-[15px]',
              'shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_1px_2px_rgba(60,40,20,0.04)] backdrop-blur-sm',
              'transition-[border-color,box-shadow] duration-200',
              'hover:border-foreground/30',
              'focus-visible:border-primary/55 focus-visible:shadow-[0_0_0_3px_hsl(18_52%_36%/0.16),0_1px_0_rgba(255,255,255,0.7)_inset] focus-visible:outline-none',
              'data-[invalid=true]:border-destructive/60',
              'data-[state=open]:border-primary/55 data-[state=open]:shadow-[0_0_0_3px_hsl(18_52%_36%/0.16),0_1px_0_rgba(255,255,255,0.7)_inset]',
            )}
          >
            <span
              className={cn(
                'truncate text-left',
                value ? 'text-foreground' : 'text-muted-foreground/70',
              )}
            >
              {value ? formatDisplay(value) : placeholder}
            </span>
            <CalendarIcon
              aria-hidden
              className="text-foreground/70 ml-2 size-4 shrink-0"
              strokeWidth={1.75}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-auto p-0"
          // Don't pull focus into the calendar grid on open; the trigger
          // already has focus and keyboard arrow keys take over once
          // inside.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? defaultMonth ?? undefined}
            disabled={minDate ? { before: minDate } : undefined}
            onSelect={(d) => {
              if (!d) return;
              onChange(toDateString(d));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
