import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import type { Trip, TripStatus } from '@/lib/trips';
import { formatTripDateRange } from '@/lib/trips/format';

import { TripStatusBadge } from './trip-status-badge';

// Compact phone-only form. Tight single-line row reads at-a-glance — the
// laptop card's chrome (corner stamp, summary, hover gradient) is
// information density laptop has room for; phone trades it for scannable
// height. Date range is the load-bearing field and never gets dropped.
function formatCompactRange(start: Date | null, end: Date | null): string {
  if (!start && !end) return 'Dates TBC';

  const fmtDay = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
  const fmtYear = (d: Date) => d.getUTCFullYear().toString();

  if (start && end) {
    const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
    return sameYear
      ? `${fmtDay(start)} – ${fmtDay(end)} ${fmtYear(end)}`
      : `${fmtDay(start)} ${fmtYear(start)} – ${fmtDay(end)} ${fmtYear(end)}`;
  }
  if (start) return `From ${fmtDay(start)} ${fmtYear(start)}`;
  return `Until ${fmtDay(end!)} ${fmtYear(end!)}`;
}

// Status-dot colour mirrors the badge variant so the row's at-a-glance
// signal stays consistent with the laptop card. Reads `bg-current` of an
// element coloured by the matching status text utility.
const STATUS_DOT_COLOR: Record<TripStatus, string> = {
  planned: 'text-foreground/65',
  active: 'text-primary',
  completed: 'text-accent',
  archived: 'text-foreground/45',
};

export function TripListCard({ trip, index }: { trip: Trip; index: number }) {
  const indexLabel = String(index + 1).padStart(2, '0');
  const range = formatTripDateRange(trip.startDate, trip.endDate);
  const compactRange = formatCompactRange(trip.startDate, trip.endDate);
  const isArchived = trip.status === 'archived';

  return (
    <Link
      href={{ pathname: `/trips/${trip.id}` }}
      className="atlas-rise group focus-visible:ring-primary/40 focus-visible:ring-offset-background block rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {/* Phone: stacked row. Date eyebrow on top, title beneath — the title
       *  wraps to as many lines as it needs rather than truncating, so a
       *  long destination name is never clipped. Dot flanks the date line;
       *  the chevron is centred over the whole row. The card is the Link
       *  target, so the full surface stays a 44 px+ tap target. */}
      <div
        className={
          'border-foreground/12 bg-card/70 flex items-center gap-3 rounded-xl border px-4 py-3 sm:hidden ' +
          // `group-active:` is the touch press feedback; hover is gated to
          // pointer devices so it doesn't stick on a tap-and-release.
          'group-active:bg-card [@media(hover:hover)]:group-hover:bg-card transition-colors'
        }
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            aria-hidden
            className={`mt-[5px] size-1.5 shrink-0 rounded-full bg-current ${STATUS_DOT_COLOR[trip.status]}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-foreground/70 font-mono text-[10px] tracking-[0.14em] uppercase">
              {compactRange}
            </p>
            <h3
              className={
                'font-display mt-1 text-base leading-snug font-medium tracking-tight break-words ' +
                (isArchived ? 'text-foreground/60' : 'text-foreground')
              }
            >
              {trip.title}
            </h3>
          </div>
        </div>
        <span aria-hidden className="text-foreground/40 shrink-0 font-mono text-xs">
          →
        </span>
      </div>

      {/* Laptop: full card. Same data, different density — corner stamp,
       *  summary preview, status badge with the hover gradient flourish. */}
      <Card
        variant="glass"
        className="relative hidden h-full overflow-hidden transition-transform duration-500 hover:-translate-y-0.5 sm:block"
      >
        <span
          aria-hidden
          className="border-foreground/25 text-foreground/70 absolute top-4 right-4 inline-flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[10px]"
        >
          {indexLabel}
        </span>

        <CardContent className="flex flex-col gap-4 px-6 py-6 sm:px-7 sm:py-7">
          <div className="flex flex-col gap-2 pr-12">
            <p className="text-foreground/70 font-mono text-[10px] tracking-[0.28em] uppercase">
              {range}
            </p>
            <h3
              className={
                'font-display text-foreground text-2xl leading-tight font-medium tracking-tight sm:text-[28px] ' +
                (isArchived ? 'text-foreground/60' : '')
              }
            >
              {trip.title}
            </h3>
          </div>

          {trip.summary && (
            <p className="text-muted-foreground line-clamp-2 text-sm leading-relaxed">
              {trip.summary}
            </p>
          )}

          <div className="mt-1 flex items-center justify-between gap-3">
            <TripStatusBadge status={trip.status} />
            <span
              aria-hidden
              className="from-primary/0 via-primary/50 to-primary/0 h-px w-12 bg-gradient-to-r transition-all duration-500 group-hover:w-24"
            />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
