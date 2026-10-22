import { Card } from '@/components/ui/card';
import type { SegmentType } from '@/lib/segments';
import { cn } from '@/lib/utils';

import { SEGMENT_TONE } from './segment-tone';

interface SegmentCardShellProps {
  // Picks the stub's tone (SEGMENT_TONE) — the only per-type visual
  // difference on the card; the body is identical across types.
  type: SegmentType;
  glyph: React.ReactNode;
  typeLabel: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  // The stub's time block — a depart / arrive pair on flights, check-in on
  // hotels, SegmentTimeMeta elsewhere. Rendered on the tone fill, so it
  // inherits the tone's ink (currentColor) instead of setting a colour.
  meta?: React.ReactNode;
  // Bottom slot — typically a row of document chips. Renders only when
  // provided; the divider is part of the slot, not a peer.
  footer?: React.ReactNode;
  // ADR-0008 advisory: set by the document-extraction pipeline when an
  // auto-created segment's startsAt falls outside the trip's ±2 day
  // window. Renders a slim strip at the top of the card. Has no
  // enforcement — the user confirms by editing, moving, or just
  // shrugging at it.
  needsReview?: boolean;
  className?: string;
}

// Room for the action cluster SegmentRow pins at `top-3 right-3` (edit +
// delete, plus reschedule on activities and food), from `sm:` up where the
// stub is a left column. A float rather than a right padding, so only the
// lines beside the buttons give way. Below `sm:` the cluster sits in the
// stub strip instead (see STUB_LAYOUT) and the body needs no reservation.
// The cluster's width depends on the input type: `size-11` buttons on
// touch for the 44px tap-target rule (#123), `size-7` on pointer;
// SegmentRow sets both widths for the buttons that row actually has.
export function ActionLaneSpacer() {
  return (
    <span
      aria-hidden
      className="float-right ml-2 hidden h-11 w-[calc(var(--segment-action-lane,9.5rem)-0.75rem)] sm:block [@media(hover:hover)]:h-7 [@media(hover:hover)]:w-[var(--segment-action-row,5.5rem)]"
    />
  );
}

// Stub geometry shared by every ticket: a strip across the top on phone
// (right padding clears the action cluster) and a fixed-width column from
// `sm:` up. Pairs with the adaptive `.ticket-stub` perforation in
// globals.css.
export const STUB_LAYOUT =
  'ticket-stub flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 py-3 pr-[var(--segment-action-lane,9.5rem)] pl-4 min-h-[3.75rem] [@media(hover:hover)]:pr-[calc(var(--segment-action-row,5.5rem)+1.5rem)] sm:min-h-0 sm:w-28 sm:flex-col sm:flex-nowrap sm:items-start sm:gap-2 sm:px-3.5 sm:py-5 sm:[@media(hover:hover)]:pr-3.5';

// Label row inside the stub: icon + type word.
export const STUB_LABEL =
  'flex items-center gap-1.5 font-mono text-[10px] leading-none font-medium tracking-[0.08em] uppercase';

// Shared ticket for every segment card variant: a tone-filled stub (icon,
// type, time) joined by a perforation to a body (title, subtitle, footer).
// Variants pass in only what's specific to their type. Inside a day card the
// ticket drops its own chrome (see DayGroup), so a day reads as one ticket
// book rather than a stack of separate cards.
export function SegmentCardShell({
  type,
  glyph,
  typeLabel,
  title,
  subtitle,
  meta,
  footer,
  needsReview = false,
  className,
}: SegmentCardShellProps) {
  return (
    <Card variant="paper" className={cn('ticket overflow-hidden', className)}>
      {needsReview && (
        <div
          role="status"
          aria-label="Date outside trip window — review"
          // `py-4` so the strip fully contains the action cluster SegmentRow
          // pins at `top-3`; the right pad reserves that cluster's lane (see
          // the body below for the two widths).
          className="bg-seg-note text-seg-note-ink flex items-center gap-3 py-4 pr-[var(--segment-action-lane,9.5rem)] pl-4 sm:pl-5 [@media(hover:hover)]:pr-28"
        >
          <span className="font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
            Review
          </span>
          <span className="text-xs leading-snug">Date is outside the trip window.</span>
        </div>
      )}
      <div className="flex flex-col sm:flex-row">
        <div className={cn(STUB_LAYOUT, SEGMENT_TONE[type])}>
          <p className={STUB_LABEL}>
            {/* Decorative — the label beside it names the type in words. */}
            <span aria-hidden className="shrink-0 [&_svg]:size-3.5">
              {glyph}
            </span>
            <span className="min-w-0 truncate">{typeLabel}</span>
          </p>
          {meta}
        </div>
        <div className="min-w-0 flex-1 px-4 py-3.5 sm:py-5 sm:pr-4 sm:pl-5">
          <ActionLaneSpacer />
          {/* `break-words` is the backstop for a single word wider than the
           *  column — "Shijiazhuangdongzhan" at 360px. */}
          <h3 className="font-display text-foreground text-lg leading-tight tracking-tight break-words sm:text-xl">
            {title}
          </h3>
          {subtitle && (
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{subtitle}</p>
          )}
          {footer && <div className="border-border clear-both mt-3 border-t pt-3">{footer}</div>}
        </div>
      </div>
    </Card>
  );
}
