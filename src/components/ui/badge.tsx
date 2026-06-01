import { tv, type VariantProps } from 'tailwind-variants';
import * as React from 'react';

import { cn } from '@/lib/utils';

// The canonical Atlas micro-label: a mono, uppercase, wide-tracked pill.
// Before this primitive existed the recipe was hand-rolled 10+ times with
// drifting tracking (0.18/0.2/0.24/0.28em) and sizes — one source of truth now.
const badgeVariants = tv({
  base: 'inline-flex items-center gap-1.5 rounded-full border font-mono uppercase whitespace-nowrap',
  variants: {
    variant: {
      // Quiet ink outline — the default metadata chip.
      default: 'border-foreground/20 text-foreground/70',
      // Terracotta — brand state (active, primary status).
      primary: 'border-primary/40 text-primary',
      // Sage — the quiet secondary register.
      accent: 'border-accent/40 text-accent',
      // Solid terracotta — a filled status badge.
      solid: 'border-transparent bg-primary text-primary-foreground',
      // Muted — de-emphasised / disabled-ish.
      muted: 'border-foreground/10 text-muted-foreground',
    },
    size: {
      default: 'h-6 px-2.5 text-[10px] tracking-[0.2em]',
      sm: 'h-5 px-2 text-[9px] tracking-[0.18em]',
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
