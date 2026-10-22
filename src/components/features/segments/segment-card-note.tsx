import { StickyNote } from 'lucide-react';

import { Card } from '@/components/ui/card';
import type { Segment } from '@/lib/segments';
import { noteDataSchema } from '@/lib/segments';
import { cn } from '@/lib/utils';

import { ActionLaneSpacer, STUB_LABEL, STUB_LAYOUT } from './segment-card-shell';
import { SegmentTimeMeta } from './segment-time-meta';
import { SEGMENT_TONE } from './segment-tone';

// Notes share the ticket stub but not the shell's title: the body IS the
// content. Line-clamped at four lines so it doesn't tower over neighbouring
// tickets.
export function SegmentCardNote({
  segment,
  showDate = false,
}: {
  segment: Segment;
  showDate?: boolean;
}) {
  const parse = noteDataSchema.safeParse(segment.data);
  const body = parse.success ? parse.data.body : '';

  return (
    <Card variant="paper" className="ticket overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        <div className={cn(STUB_LAYOUT, SEGMENT_TONE.note)}>
          <p className={STUB_LABEL}>
            <StickyNote aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
            Note
          </p>
          <SegmentTimeMeta startsAt={segment.startsAt} endsAt={null} showDate={showDate} />
        </div>
        <div className="min-w-0 flex-1 px-4 py-3.5 sm:py-5 sm:pr-4 sm:pl-5">
          <ActionLaneSpacer />
          <p className="text-foreground/90 line-clamp-4 text-sm leading-relaxed whitespace-pre-wrap">
            {body}
          </p>
        </div>
      </div>
    </Card>
  );
}
