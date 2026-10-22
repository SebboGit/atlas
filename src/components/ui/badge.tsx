import { tv, type VariantProps } from 'tailwind-variants';
import * as React from 'react';

import { cn } from '@/lib/utils';

// The canonical Atlas micro-label: a mono, uppercase pill. One source of
// truth for status chips, so tracking and sizes don't drift screen to screen.
const badgeVariants = tv({
  base: 'inline-flex items-center gap-1.5 rounded-full border font-mono uppercase whitespace-nowrap',
  variants: {
    variant: {
      // Quiet filled chip — the default metadata label.
      default: 'border-transparent bg-muted text-foreground/80',
      // Coral — brand state (active, today). Ink on the coral fill.
      primary: 'border-transparent bg-primary text-primary-foreground',
      // Ink outline — a neutral state that should still read (planned).
      accent: 'border-foreground text-foreground',
      // Solid coral — kept as an alias of `primary` for existing callers.
      solid: 'border-transparent bg-primary text-primary-foreground',
      // Muted — de-emphasised / disabled-ish.
      muted: 'border-border text-muted-foreground',
    },
    size: {
      default: 'h-6 px-2.5 text-[11px] tracking-[0.06em]',
      sm: 'h-5 px-2 text-[10px] tracking-[0.06em]',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
