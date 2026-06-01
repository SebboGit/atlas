import { Card, CardContent } from '@/components/ui/card';
import type { SegmentType } from '@/lib/segments';
import { cn } from '@/lib/utils';

// Per-type accent for the glyph circle ONLY — its border + icon colour.
// One map, one source of truth, so a day's shape stays legible at a
// glance without tinting the whole card. Flights carry the single
// terracotta brand accent (the signature segment); every other dated
// type takes the quiet sage register; notes stay muted ink.
//
// Keep this scoped to the circle: title, meta, spacing, and rhythm are
// byte-identical across types by design (see SegmentCardShell's body).
export const GLYPH_ACCENT: Record<SegmentType, string> = {
  flight: 'border-primary/40 text-primary',
  hotel: 'border-accent/40 text-accent',
  activity: 'border-accent/40 text-accent',
  food: 'border-accent/40 text-accent',
  transit: 'border-accent/40 text-accent',
  note: 'border-foreground/15 text-foreground/45',
};

interface SegmentCardShellProps {
  // Drives the glyph circle's accent (border + icon colour) via the
  // GLYPH_ACCENT map. The only per-type visual difference on the card —
  // everything else stays identical across types.
  type: SegmentType;
  glyph: React.ReactNode;
  typeLabel: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  // Top-right slot — typically a stacked time pair (depart / arrive) or
  // a small status chip ("Wishlist").
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
  // Opt-in for variants whose `meta` is too dense to share a row with
  // the title at mobile widths — currently just flights, whose meta
  // is a two-line stacked time block that crowds the route headline.
  // Other variants (hotel chip, activity status) stay right-aligned.
  stackMetaOnMobile?: boolean;
  className?: string;
}

// Shared body for every segment card variant. Variants pass in only
// what's specific to their type (glyph, label, parsed data). Keeps the
// visual rhythm identical across types so the itinerary reads as one
// coherent column rather than five.
export function SegmentCardShell({
  type,
  glyph,
  typeLabel,
  title,
  subtitle,
  meta,
  footer,
  needsReview = false,
  stackMetaOnMobile = false,
  className,
}: SegmentCardShellProps) {
  return (
    <Card variant="paper" className={cn('overflow-hidden', className)}>
      {needsReview && (
        <div
          role="status"
          aria-label="Date outside trip window — review"
          className="border-foreground/12 bg-foreground/[0.04] flex items-center gap-3 border-b py-2.5 pr-28 pl-5 sm:pl-6"
        >
          <span className="text-foreground/70 font-mono text-[9px] tracking-[0.28em] uppercase">
            Review
          </span>
          <span aria-hidden className="bg-foreground/20 h-px w-4" />
          <span className="text-foreground/75 text-xs leading-snug">
            Date is outside the trip window.
          </span>
        </div>
      )}
      <CardContent
        // Right padding is wider than left to reserve room for the
        // absolutely-positioned action cluster (SegmentRow renders
        // edit + delete, plus reschedule on activities — three
        // h-7 w-7 buttons at top-3 right-3 add up to ~100px). pr-28
        // unconditionally because the two-button case has lots of
        // air to spare but the three-button case on mobile is the
        // one that visually clips — covering both with the wider
        // pad keeps the worst case comfortable. Notes use their own
        // layout, not this shell.
        className="flex gap-4 py-5 pr-28 pl-5 sm:gap-5 sm:py-6 sm:pl-6"
      >
        <div
          aria-hidden
          className={cn(
            'mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border [&_svg]:size-5',
            GLYPH_ACCENT[type],
          )}
        >
          {glyph}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className={cn(
              'flex justify-between gap-4',
              // When the meta is dense (flights), drop to a column on
              // mobile so the time block doesn't crowd the route
              // headline. Re-joins the row at sm: where there's room.
              stackMetaOnMobile ? 'flex-col items-start sm:flex-row sm:items-start' : 'items-start',
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="text-foreground/75 font-mono text-[10px] tracking-[0.18em] uppercase sm:tracking-[0.28em]">
                {typeLabel}
              </p>
              <h3 className="font-display text-foreground mt-1 text-lg leading-tight font-medium tracking-tight sm:text-[20px]">
                {title}
              </h3>
              {subtitle && (
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{subtitle}</p>
              )}
            </div>
            {meta && (
              <div
                className={cn(
                  'shrink-0',
                  // Stacked: meta sits flush-left below the subtitle
                  // with a small gap; row mode keeps its right-aligned
                  // home in the title row.
                  stackMetaOnMobile ? 'mt-2 sm:mt-0 sm:text-right' : 'text-right',
                )}
              >
                {meta}
              </div>
            )}
          </div>
          {footer && <div className="border-foreground/10 mt-4 border-t pt-3">{footer}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
