'use client';

import { Clock } from 'lucide-react';
import * as React from 'react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface TimePickerProps {
  /** `hh:mm` (24-hour) or '' when empty. */
  value: string;
  onChange: (next: string) => void;
  id?: string;
  name?: string;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Minute granularity for the custom popover. Default: 5. */
  step?: 5 | 10 | 15 | 30;
  className?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/**
 * Responsive TimePicker.
 *
 * Touch devices (pointer:coarse): native `<input type="time">` — best
 * accessibility, native wheel/scroll on iOS, no JS picker needed.
 *
 * Pointer devices (pointer:fine): custom popover with two scrollable
 * columns (hours / minutes) styled to match the Atlas DatePicker so a
 * paired date+time field reads as one cohesive surface.
 *
 * Both representations are mounted; CSS hides the wrong one for the
 * device. Same `hh:mm` data shape either way.
 */
export function TimePicker({
  value,
  onChange,
  id,
  name,
  invalid,
  disabled,
  placeholder = '--:--',
  step = 5,
  className,
}: TimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const minuteRef = React.useRef<HTMLDivElement>(null);
  const hourRef = React.useRef<HTMLDivElement>(null);

  const minutes = React.useMemo(
    () => Array.from({ length: Math.floor(60 / step) }, (_, i) => i * step),
    [step],
  );

  const [hh, mm] = React.useMemo(() => {
    if (!value) return [undefined, undefined] as const;
    const m = /^(\d{2}):(\d{2})$/.exec(value);
    if (!m) return [undefined, undefined] as const;
    return [Number(m[1]), Number(m[2])] as const;
  }, [value]);

  // When opening, scroll selected hour/minute into view. Without this
  // the user has to hunt for their current selection in the column.
  React.useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      hourRef.current
        ?.querySelector<HTMLElement>('[data-selected="true"]')
        ?.scrollIntoView({ block: 'center' });
      minuteRef.current
        ?.querySelector<HTMLElement>('[data-selected="true"]')
        ?.scrollIntoView({ block: 'center' });
    }, 20);
    return () => window.clearTimeout(id);
  }, [open]);

  function pickHour(h: number) {
    onChange(`${pad2(h)}:${pad2(mm ?? 0)}`);
  }

  function pickMinute(m: number) {
    onChange(`${pad2(hh ?? 0)}:${pad2(m)}`);
  }

  return (
    <div className={cn('relative', className)}>
      {/* Native — visible only on coarse pointer (touch). */}
      <Input
        id={id}
        name={name}
        type="time"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        className="[@media(pointer:fine)]:hidden"
      />

      {/* Custom — visible only on fine pointer (mouse / trackpad / pen). */}
      <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id ? `${id}-trigger` : undefined}
            disabled={disabled}
            data-invalid={invalid || undefined}
            aria-haspopup="dialog"
            aria-label="Time"
            className={cn(
              'hidden [@media(pointer:fine)]:flex',
              // Match DatePicker visuals so date + time read as one row.
              'border-foreground/15 bg-card/70 h-11 w-full items-center justify-between rounded-xl border px-3 text-[15px]',
              'shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_1px_2px_rgba(60,40,20,0.04)] backdrop-blur-sm',
              'transition-[border-color,box-shadow] duration-200',
              'hover:border-foreground/30',
              'focus-visible:border-primary/55 focus-visible:shadow-[0_0_0_3px_hsl(18_52%_36%/0.16),0_1px_0_rgba(255,255,255,0.7)_inset] focus-visible:outline-none',
              'data-[invalid=true]:border-destructive/60',
              'data-[state=open]:border-primary/55 data-[state=open]:shadow-[0_0_0_3px_hsl(18_52%_36%/0.16),0_1px_0_rgba(255,255,255,0.7)_inset]',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <span
              className={cn(
                'truncate text-left tabular-nums',
                value ? 'text-foreground' : 'text-muted-foreground/70',
              )}
            >
              {value || placeholder}
            </span>
            <Clock
              aria-hidden
              className="text-foreground/55 ml-2 size-4 shrink-0"
              strokeWidth={1.75}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          // Two slim columns. End-aligned because the trigger usually
          // sits at the right edge of a date+time row.
          className="flex w-auto p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Column label="HH" ref={hourRef} items={HOURS} selected={hh} onPick={pickHour} />
          <div className="border-foreground/10 border-l" aria-hidden />
          <Column label="MM" ref={minuteRef} items={minutes} selected={mm} onPick={pickMinute} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface ColumnProps {
  label: string;
  items: number[];
  selected: number | undefined;
  onPick: (n: number) => void;
}

const Column = React.forwardRef<HTMLDivElement, ColumnProps>(
  ({ label, items, selected, onPick }, ref) => (
    <div className="flex flex-col">
      <div className="text-foreground/50 px-3 pt-2 pb-1 text-center font-mono text-[9px] tracking-[0.22em] uppercase">
        {label}
      </div>
      <div
        ref={ref}
        // Stop wheel events bubbling so the parent dialog's
        // react-remove-scroll lock doesn't preventDefault our scroll.
        onWheel={(e) => e.stopPropagation()}
        className="flex max-h-56 w-16 flex-col overflow-y-auto px-1 pb-1"
      >
        {items.map((n) => {
          const isSelected = n === selected;
          return (
            <button
              key={n}
              type="button"
              data-selected={isSelected || undefined}
              onClick={() => onPick(n)}
              className={cn(
                'mx-auto my-px inline-flex h-8 w-12 items-center justify-center rounded-full',
                'text-foreground text-[13px] leading-none tabular-nums transition-colors',
                'hover:bg-foreground/8',
                'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:outline-none',
                isSelected && 'bg-primary text-primary-foreground hover:bg-primary/92',
              )}
            >
              {pad2(n)}
            </button>
          );
        })}
      </div>
    </div>
  ),
);
Column.displayName = 'TimePickerColumn';
