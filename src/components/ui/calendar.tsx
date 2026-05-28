'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';

import { cn } from '@/lib/utils';

/**
 * Atlas-skinned calendar. Bare-DayPicker; no default stylesheet imported.
 * Every visual decision lives in this file so the aesthetic stays in
 * one place.
 *
 * Visual brief:
 *  - Container reads as a small notebook page (paper card surface).
 *  - Month label in Fraunces; weekday letters in monospace small-caps.
 *  - Selected day: filled terracotta disc.
 *  - Today: a thin terracotta dot beneath the day number.
 *  - Outside-month days: 30% opacity, still clickable.
 *  - Prev / Next: hairline-bordered round chevron buttons.
 *
 * Weeks start on Monday (matches the en-GB date strings used elsewhere).
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: DayPickerProps) {
  return (
    <DayPicker
      weekStartsOn={1}
      // Lock to 6 rows so the popover height doesn't jump when paging
      // between months with 4, 5 or 6 visible weeks. Trailing days from
      // the next month render as outside-of-month (low opacity).
      fixedWeeks
      formatters={{
        formatWeekdayName: (day) =>
          day.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2),
        formatCaption: (date) =>
          date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? (
            <ChevronLeft className="size-4" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="size-4" strokeWidth={1.75} />
          ),
      }}
      showOutsideDays={showOutsideDays}
      className={cn('px-4 py-4', className)}
      classNames={{
        months: 'flex flex-col',
        month: 'flex flex-col gap-3',

        month_caption: 'relative flex items-center justify-center pb-2',
        caption_label:
          'font-display text-foreground text-[17px] tracking-tight font-medium leading-none capitalize',

        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous: cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full',
          'border-foreground/15 text-foreground/65 hover:bg-foreground/8 hover:text-foreground',
          'border transition-colors',
          'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-card focus-visible:outline-none',
        ),
        button_next: cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full',
          'border-foreground/15 text-foreground/65 hover:bg-foreground/8 hover:text-foreground',
          'border transition-colors',
          'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-card focus-visible:outline-none',
        ),

        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'text-foreground/70 w-9 flex-1 pb-1 font-mono text-[9px] tracking-[0.22em] uppercase font-normal',

        week: 'flex w-full',
        day: 'w-9 flex-1 p-0 text-center',
        day_button: cn(
          'relative inline-flex h-9 w-9 items-center justify-center rounded-full',
          'text-foreground text-[13px] leading-none transition-colors',
          'hover:bg-foreground/8',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          'focus-visible:ring-offset-1 focus-visible:ring-offset-card',
          'disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed',
        ),

        // Today: subtle terracotta dot beneath the number. Pure CSS
        // pseudo-element via ::after attached at the day button level.
        today:
          '[&_button]:after:absolute [&_button]:after:bottom-1 [&_button]:after:left-1/2 [&_button]:after:size-1 [&_button]:after:-translate-x-1/2 [&_button]:after:rounded-full [&_button]:after:bg-primary',

        // Selected: filled terracotta disc, cream text. Wins over today.
        selected:
          '[&_button]:bg-primary [&_button]:text-primary-foreground [&_button]:hover:bg-primary/92 [&_button]:after:bg-primary-foreground/70',

        // Outside-month days: faded but still clickable.
        outside: '[&_button]:text-foreground/35',
        disabled: '[&_button]:text-foreground/25',
        hidden: 'invisible',

        ...classNames,
      }}
      {...props}
    />
  );
}
