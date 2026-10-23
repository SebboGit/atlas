import type * as React from 'react';

import { cn } from '@/lib/utils';

// Layout primitives for the read-only inspector dialogs — the segment
// one and the wishlist one. Extracted so the two can't drift: these
// carry the whole visual contract (mono section headers, the hairline
// definition list, the label column width) in class strings that would
// otherwise be copy-pasted and diverge on the next tweak.

/**
 * A titled block of {@link InfoRow}s. Rows with no value render
 * nothing, so the caller must gate the whole section on "any of these
 * fields exist" — otherwise an all-empty section leaves a stranded
 * header. This stays a presentation primitive; it can't inspect what
 * its children rendered.
 */
export function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-foreground/70 font-mono text-[10px] tracking-[0.28em] uppercase">
        {title}
      </h4>
      <dl className="border-foreground/10 divide-foreground/8 divide-y rounded-xl border">
        {children}
      </dl>
    </section>
  );
}

/** One label/value pair. Renders nothing when the value is empty. */
export function InfoRow({
  label,
  value,
  mono = false,
  multiline = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  multiline?: boolean;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div
      className={cn(
        'flex gap-4 px-4 py-2.5',
        multiline ? 'flex-col gap-1 sm:flex-row sm:gap-4' : 'items-baseline',
      )}
    >
      <dt className="text-foreground/70 w-24 shrink-0 font-mono text-[10px] tracking-[0.2em] uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          'text-foreground/90 min-w-0 flex-1 text-sm leading-relaxed',
          mono && 'font-mono tracking-wider',
          multiline && 'whitespace-pre-wrap',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
