'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Warm tinted backdrop, slight blur so the dialog feels lifted off the page.
      'atlas-overlay fixed inset-0 z-50 bg-[hsl(28_22%_12%/0.42)] backdrop-blur-[3px]',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Mobile: full-width sheet pinned to the bottom of the viewport with
        //   safe-area padding so nothing hides under the iOS home indicator.
        // Laptop: centered card, capped at 540px.
        // [&>*]:min-w-0 — grid items default to `min-width: auto` (their
        // own min-content). Without this override, a deeply-nested
        // unbreakable string (long MIME type, long URL, etc.) pushes the
        // form/header track wider than the dialog's max-width and the
        // dialog overflows horizontally. min-w-0 lets the track shrink
        // and the existing truncate/break-words on inner elements does
        // its job.
        'atlas-sheet bg-card text-card-foreground fixed z-50 grid w-full gap-6 border shadow-[var(--shadow-overlay)] [&>*]:min-w-0',
        'border-foreground/12 backdrop-blur-2xl',
        // Mobile bottom sheet — content can scroll inside if the form
        // is tall (date pickers, status, etc.). Top capped so the close
        // affordance never falls off the top of the screen. overflow-x
        // is locked hidden because a dialog is a constrained surface —
        // any inner overflow is always a bug, never a feature.
        'inset-x-0 bottom-0 max-h-[88vh] overflow-x-hidden overflow-y-auto rounded-t-3xl px-6 pt-7 pb-[max(1.75rem,env(safe-area-inset-bottom))]',
        // Promote to centered card from sm: up. Same overflow guards.
        'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[88vh] sm:max-w-[34rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-8',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={cn(
          'absolute top-4 right-4 inline-flex h-9 w-9 items-center justify-center rounded-full',
          'border-foreground/15 text-foreground/70 hover:bg-foreground/8 border transition-colors',
          'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-background focus-visible:outline-none',
        )}
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-2', className)} {...props} />;
}
DialogHeader.displayName = 'DialogHeader';

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}
DialogFooter.displayName = 'DialogFooter';

// Apply to the <form> or wrapping <div> inside DialogContent that holds
// a DialogScrollableBody + DialogStickyFooter. The max-h bounds the form
// inside the dialog so the body's inner scroll is the ONLY scroll axis
// engaged — DialogContent's own max-h-[88vh] + overflow-y-auto stays
// dormant as long as the form fits, which it always does with this
// bound. The action footer sits at the form's natural bottom inside
// these bounds, so Save / Cancel are always reachable.
const dialogScrollContainer = 'flex max-h-[calc(85vh-7rem)] flex-col gap-0';

// Scrollable inner region of a dialog body — pair with `dialogScrollContainer`
// on the parent and DialogStickyFooter as a sibling. The `flex-1` claims
// the remaining height inside the bounded form; `overflow-y-auto` scrolls
// when the field stack is taller than that space. `pr-1` reserves a hair
// for the scrollbar so it doesn't crowd the rightmost field edges. The
// `min-h-0` reset is what lets the body actually shrink below its content
// in a flex column — without it, `min-height: auto` keeps the body at its
// intrinsic height and overflow falls back to the outer DialogContent.
//
// `overflow-x-hidden` + `min-w-0` are the horizontal counterparts, and
// they are not optional: setting `overflow-y-auto` alone makes the
// browser *compute* `overflow-x` to `auto` (the spec coerces a `visible`
// axis to `auto` when its sibling axis scrolls), so this body silently
// becomes a horizontal scroller too. On iOS Safari a native control
// (`<select>`, `<input type="date|time">`) carries an intrinsic
// min-width that does not shrink to its `width:100%` box; without a
// `min-w-0` ancestor it pushes the field stack wider than the body and
// that latent x-axis turns into a real sideways scroll inside the dialog
// (Android/Chromium shrink the control instead, so the bug is
// iOS-only). Pinning `overflow-x-hidden` here makes the clip explicit
// and `min-w-0` lets the body shrink in its flex parent. A dialog is a
// constrained surface — horizontal overflow is always a bug, never a
// feature (mirrors the same guard on DialogContent).
const DialogScrollableBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto pr-1 pb-1',
        className,
      )}
      {...props}
    />
  ),
);
DialogScrollableBody.displayName = 'DialogScrollableBody';

// Action footer for dialogs with a scrollable body — sits at the bottom
// of the bounded form so Save / Cancel never fall below the viewport.
// Negative margins let the divider span the full DialogContent width
// despite the dialog's px-6 (mobile) / sm:p-8 (laptop) padding, and
// -mb / sm:-mb let the footer's bg cover the dialog's pb area cleanly.
// The mobile pb expands to `env(safe-area-inset-bottom)` so the action
// row clears an iOS home indicator even when the dialog's outer pb
// alone wouldn't (e.g. on devices where Safari shrinks the visual
// viewport without telling the layout).
const DialogStickyFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'border-foreground/15 bg-card -mx-6 mt-4 -mb-6 flex flex-col-reverse gap-3 border-t px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:-mx-8 sm:-mb-8 sm:flex-row sm:items-center sm:justify-end sm:py-4',
        className,
      )}
      {...props}
    />
  ),
);
DialogStickyFooter.displayName = 'DialogStickyFooter';

const DialogEyebrow = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      'text-foreground/70 flex items-center gap-3 font-mono text-[10px] tracking-[0.28em] uppercase',
      className,
    )}
    {...props}
  />
));
DialogEyebrow.displayName = 'DialogEyebrow';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'font-display text-foreground text-3xl leading-tight font-medium tracking-tight',
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-muted-foreground text-sm leading-relaxed', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogEyebrow,
  DialogTitle,
  DialogDescription,
  DialogScrollableBody,
  DialogStickyFooter,
  dialogScrollContainer,
};
