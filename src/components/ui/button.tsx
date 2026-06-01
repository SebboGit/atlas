import { Slot } from '@radix-ui/react-slot';
import { tv, type VariantProps } from 'tailwind-variants';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = tv({
  base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium tracking-tight transition-[background-color,box-shadow,transform,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none active:translate-y-[0.5px] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  variants: {
    variant: {
      // Terracotta ink — single brand action.
      default:
        'bg-primary text-primary-foreground shadow-[0_8px_24px_-12px_hsl(18_52%_36%/0.7),inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-primary/92 hover:shadow-[0_10px_28px_-12px_hsl(18_52%_36%/0.85),inset_0_1px_0_rgba(255,255,255,0.12)] disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none',
      // Ink — high-contrast secondary.
      ink: 'bg-foreground text-background hover:bg-foreground/88 shadow-[0_8px_22px_-14px_rgba(40,28,18,0.7)] disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none',
      // Outline — paper-lined.
      outline:
        'border border-foreground/25 bg-card/40 hover:bg-card/70 hover:border-foreground/40 text-foreground disabled:opacity-50',
      // Ghost — quietest possible affordance.
      ghost: 'hover:bg-foreground/8 text-foreground/80 hover:text-foreground disabled:opacity-50',
      // Link — underline-on-hover, for inline.
      link: 'text-primary underline-offset-4 hover:underline disabled:opacity-50',
    },
    size: {
      default: 'h-10 px-5 py-2',
      sm: 'h-9 px-4 text-[13px]',
      lg: 'h-12 px-7 text-[15px]',
      icon: 'h-10 w-10',
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
