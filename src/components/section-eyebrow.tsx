import * as React from 'react';

import { cn } from '@/lib/utils';

// The chapter eyebrow that opens every top-level screen: a hairline rule
// + a mono, wide-tracked "Section NN · Name" caption. Visible at all widths
// — it used to be gated behind `sm:`, which left 360px headers bare and
// made the section-numbering system read as an accident.
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
        'text-muted-foreground mb-4 flex items-center gap-3 font-mono text-[10px] tracking-[0.28em] uppercase',
        className,
      )}
    >
      <span aria-hidden className="bg-foreground/30 h-px w-8" />
      <span>{children}</span>
    </p>
  );
}
