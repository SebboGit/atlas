'use client';

// Atlas-flavoured wrapper around `cmdk`. Mirrors the shadcn pattern but
// avoids the CLI scaffold so the file lives natively in our style system.
// The Dialog flavour (`CommandDialog`) is the surface the Cmd+K palette
// renders into; the bare `Command` variants are available if a future
// surface wants an inline picker.

import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import * as React from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      'bg-card text-card-foreground flex h-full w-full flex-col overflow-hidden rounded-2xl',
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

// Modal palette surface. Owns the responsive layout from CLAUDE.md:
//   - 360×640: full-screen sheet with safe-area padding.
//   - sm: up: centered card, ~640px wide, capped height.
function CommandDialog({
  open,
  onOpenChange,
  title = 'Search',
  description = 'Search trips, segments, and documents.',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Override the default Dialog padding/shape — the palette is
          // a list surface, not a form. We want the input flush with
          // the top, no bottom-sheet rounding on desktop.
          'overflow-hidden p-0',
          'inset-x-2 bottom-2 max-h-[88vh] rounded-2xl pt-0 pb-0',
          'sm:inset-x-auto sm:top-[14vh] sm:bottom-auto sm:left-1/2 sm:max-h-[70vh] sm:max-w-[640px] sm:-translate-x-1/2 sm:translate-y-0 sm:rounded-2xl',
          // Hide the default close button — the input row carries
          // affordance enough, and Esc closes the dialog natively.
          '[&>button:last-child]:hidden',
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {/* Radix Dialog auto-wires DialogDescription.id into aria-describedby;
            a bare <p className="sr-only"> would leave the warning in place. */}
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command
          // Use a custom filter? No — we filter server-side. cmdk's
          // built-in filter would re-rank our DB ordering, which we
          // explicitly want to preserve.
          shouldFilter={false}
          className="border-foreground/12 bg-card/80 supports-[backdrop-filter]:bg-card/55 border backdrop-blur-2xl"
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="border-foreground/10 flex items-center gap-3 border-b px-4" cmdk-input-wrapper="">
    <Search className="text-foreground/70 size-4 shrink-0" aria-hidden />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'placeholder:text-muted-foreground flex h-14 w-full rounded-md bg-transparent text-base outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn('max-h-[60vh] overflow-x-hidden overflow-y-auto py-2', className)}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="text-muted-foreground py-10 text-center text-sm"
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'text-foreground overflow-hidden p-2',
      '[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:tracking-[0.2em] [&_[cmdk-group-heading]]:uppercase',
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn('bg-foreground/10 mx-2 h-px', className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "data-[selected='true']:text-foreground relative flex min-h-[2.75rem] cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none select-none data-[disabled='true']:pointer-events-none data-[disabled='true']:opacity-50 data-[selected='true']:bg-[hsl(28_22%_50%/0.10)]",
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

function CommandShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'text-muted-foreground ml-auto font-mono text-[10px] tracking-[0.18em]',
        className,
      )}
      {...props}
    />
  );
}
CommandShortcut.displayName = 'CommandShortcut';

const CommandLoading = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Loading>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Loading>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Loading
    ref={ref}
    className={cn('text-muted-foreground py-6 text-center text-xs', className)}
    {...props}
  />
));
CommandLoading.displayName = CommandPrimitive.Loading.displayName;

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandSeparator,
  CommandItem,
  CommandShortcut,
  CommandLoading,
};
