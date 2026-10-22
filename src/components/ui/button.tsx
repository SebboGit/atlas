import { Slot } from '@radix-ui/react-slot';
import { tv, type VariantProps } from 'tailwind-variants';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = tv({
  base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-[background-color,box-shadow,transform,color,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none active:translate-y-[0.5px] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  variants: {
    variant: {
      // Coral — the single brand action. Always ink text on the fill.
      default:
        'bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground',
      // Ink — high-contrast secondary (inverts in dark mode).
      ink: 'bg-foreground text-background hover:bg-foreground/88 disabled:bg-muted disabled:text-muted-foreground',
      // Outline — a quiet bordered pill on the card surface.
      outline: 'border border-input bg-card hover:bg-muted text-foreground disabled:opacity-50',
      // Ghost — quietest possible affordance.
      ghost: 'hover:bg-foreground/8 text-foreground/80 hover:text-foreground disabled:opacity-50',
      // Link — underline-on-hover, for inline.
      link: 'text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground disabled:opacity-50',
    },
    size: {
      default: 'h-11 px-5 py-2',
      sm: 'h-9 px-4 text-[13px]',
      lg: 'h-12 px-7 text-[15px]',
      icon: 'h-11 w-11',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
