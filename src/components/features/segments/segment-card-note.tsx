import { StickyNote } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import type { Segment } from '@/lib/segments';
import { noteDataSchema } from '@/lib/segments';
import { cn } from '@/lib/utils';

import { GLYPH_ACCENT } from './segment-card-shell';

// Notes get a slightly different shell: no oversized Fraunces title,
// because the body IS the content. Body is line-clamped at four lines
// so it doesn't tower over neighbouring cards in the timeline.
export function SegmentCardNote({ segment }: { segment: Segment }) {
  const parse = noteDataSchema.safeParse(segment.data);
  const body = parse.success ? parse.data.body : '';

  return (
    <Card variant="paper" className="overflow-hidden">
      <CardContent className="flex gap-4 px-5 py-5 sm:gap-5 sm:px-6 sm:py-6">
        <div
          aria-hidden
          className={cn(
            'mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border',
            // Notes take the muted ink accent from the shared glyph map —
            // same source of truth as the shell-based cards.
            GLYPH_ACCENT.note,
          )}
        >
          <StickyNote className="size-5" strokeWidth={1.5} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-foreground/75 font-mono text-[10px] tracking-[0.28em] uppercase">
            Note
          </p>
          <p className="text-foreground/85 line-clamp-4 text-sm leading-relaxed whitespace-pre-wrap">
            {body}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
