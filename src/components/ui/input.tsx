'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

const inputClasses =
  // A hairline field on the card surface with a soft coral focus halo.
  'flex h-11 w-full rounded-xl border border-input bg-card px-4 py-2 text-[15px] text-foreground placeholder:text-muted-foreground/70 ' +
  'transition-[border-color,box-shadow] duration-200 ' +
  'focus-visible:outline-none focus-visible:border-primary/55 focus-visible:shadow-[0_0_0_3px_rgb(255_107_74/0.25)] ' +
  'disabled:cursor-not-allowed disabled:bg-muted/50 disabled:text-muted-foreground disabled:shadow-none ' +
  'aria-[invalid=true]:border-destructive/60 aria-[invalid=true]:focus-visible:shadow-[0_0_0_3px_rgb(196_40_28/0.2)]';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input ref={ref} type={type} className={cn(inputClasses, className)} {...props} />
  ),
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(inputClasses, 'min-h-28 resize-y py-3 leading-relaxed', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          inputClasses,
          // Hide the native arrow on every platform; we draw our own ink chevron.
          'appearance-none pr-10',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 12 8"
        className="text-foreground/70 pointer-events-none absolute top-1/2 right-4 -mt-1 h-2 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M1 1.5l5 5 5-5" />
      </svg>
    </div>
  ),
);
Select.displayName = 'Select';

export { Input, Textarea, Select };
