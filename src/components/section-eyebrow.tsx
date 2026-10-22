import * as React from 'react';

import { cn } from '@/lib/utils';

// The small mono caption above every top-level screen's title. Visible at
// all widths, so 360px headers aren't left bare.
export function SectionEyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'text-muted-foreground mb-2 font-mono text-xs tracking-[0.06em] uppercase',
        className,
      )}
    >
      {children}
    </p>
  );
}
