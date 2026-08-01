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
  // Top-right slot — a stacked time pair (flight depart / arrive) or the
  // segment's date+time (SegmentTimeMeta on activity / food / transit).
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
  // Other variants (hotel check-in, activity / food date+time) stay
  // right-aligned.
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
          // `py-4` (not the band's intrinsic text height) so the strip is
          // tall enough to fully contain the action cluster SegmentRow
          // pins at `top-3` — the edit/delete buttons reach ~40px down on
          // pointer devices, which a tighter band only half-covered, so
          // they read as sitting inside this strip rather than spilling
          // past its lower edge. The right pad reserves their horizontal
          // lane; see the note on CardContent below for the two widths.
          className="border-foreground/12 bg-foreground/[0.04] flex items-center gap-3 border-b py-4 pr-[9.5rem] pl-5 sm:pl-6 [@media(hover:hover)]:pr-28"
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
        // absolutely-positioned action cluster SegmentRow pins at
        // `top-3 right-3` (edit + delete, plus reschedule on activities
        // and food).
        //
        // The lane has to be measured per input type, because the
        // buttons are not one size: `size-7` on pointer → 88px of
        // cluster, but `size-11` on touch to meet the 44px tap-target
        // rule → 136px, plus the 12px `right-3` offset. A flat `pr-28`
        // (112px) covered the pointer case and left the touch cluster
        // sitting 35px INSIDE the text column, so a long title truncated
        // underneath the buttons (#123). 9.5rem = 152px clears the touch
        // cluster with 4px to spare; pointer keeps the tighter 112px.
        // Notes use their own layout, not this shell.
        className="flex gap-4 py-5 pr-[9.5rem] pl-5 sm:gap-5 sm:py-6 sm:pl-6 [@media(hover:hover)]:pr-28"
      >
        {/* Decorative only — the eyebrow directly beside it already names
         *  the type in words. Dropped on touch, where it and its gap cost
         *  56px that the wider action lane needs back; the net is still
         *  ~20px MORE text than before (#123). Gated on `hover: none`
         *  rather than a width breakpoint on purpose: a tablet is `sm:`+
         *  but still touch, and its two-column cards (344px at 768) are
         *  the narrowest of any device — a width-based rule would hand
         *  the worst case the widest lane AND keep the glyph. */}
        <div
          aria-hidden
          className={cn(
            'mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border [&_svg]:size-5',
            '[@media(hover:none)]:hidden',
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
