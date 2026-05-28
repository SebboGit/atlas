'use client';

// Atlas-flavoured Sheet — a slide-in drawer for navigation chrome on
// phone (the hamburger nav). Builds on the same Radix Dialog primitive
// as `Dialog` but skins it with side-edge positioning instead of the
// centered / bottom-sheet variants.

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'atlas-overlay fixed inset-0 z-50 bg-[hsl(28_22%_12%/0.42)] backdrop-blur-[3px]',
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

type SheetSide = 'left' | 'right';

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: SheetSide;
}

const SIDE_POSITIONING: Record<SheetSide, string> = {
  left: 'inset-y-0 left-0 w-[min(20rem,85vw)] border-r rounded-r-3xl',
  right: 'inset-y-0 right-0 w-[min(20rem,85vw)] border-l rounded-l-3xl',
};

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = 'left', className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'atlas-sheet bg-card text-card-foreground fixed z-50 flex flex-col overflow-y-auto border shadow-[0_40px_80px_-40px_rgba(40,28,18,0.45),0_12px_32px_-16px_rgba(40,28,18,0.25)]',
        'border-foreground/12 backdrop-blur-2xl',
        // Safe-area padding so the drawer's top/bottom don't tuck under
        // iOS chrome on a notched phone.
        'px-6 pt-[max(1.75rem,env(safe-area-inset-top))] pb-[max(1.75rem,env(safe-area-inset-bottom))]',
        SIDE_POSITIONING[side],
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={cn(
          // 44 px tap target — Sheet is the phone-only hamburger surface,
          // so the close affordance is always reached by touch.
          'absolute top-3 right-3 inline-flex h-11 w-11 items-center justify-center rounded-full',
          'border-foreground/15 text-foreground/70 hover:bg-foreground/8 border transition-colors',
          'focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-background focus-visible:outline-none',
        )}
      >
        <X className="h-5 w-5" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = DialogPrimitive.Content.displayName;

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'font-display text-foreground text-2xl leading-tight font-medium tracking-tight',
      className,
    )}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-muted-foreground text-sm leading-relaxed', className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetTitle,
  SheetDescription,
};
