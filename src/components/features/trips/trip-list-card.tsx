import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import type { Trip } from '@/lib/trips';

import { TripStatusBadge } from './trip-status-badge';

function formatDateRange(start: Date | null, end: Date | null): string {
  if (!start && !end) return 'Dates to come';

  const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fmtYear = (d: Date) => d.getUTCFullYear().toString();
  const fmtFull = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  if (start && end) {
    const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
    return sameYear
      ? `${fmtDay(start)} – ${fmtDay(end)} ${fmtYear(end)}`
      : `${fmtFull(start)} – ${fmtFull(end)}`;
  }
  if (start) return `From ${fmtFull(start)}`;
  return `Until ${fmtFull(end!)}`;
}

export function TripListCard({ trip, index }: { trip: Trip; index: number }) {
  const indexLabel = String(index + 1).padStart(2, '0');
  const range = formatDateRange(trip.startDate, trip.endDate);
  const isArchived = trip.status === 'archived';

  return (
    <Link
      href={{ pathname: `/trips/${trip.id}` }}
      className="atlas-rise group focus-visible:ring-primary/40 focus-visible:ring-offset-background block rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <Card
        variant="glass"
        className="relative h-full overflow-hidden transition-transform duration-500 hover:-translate-y-0.5"
      >
        {/* Corner index numeral — quiet, monospace. Decorative chrome:
         *  hidden on phone, where the half-width card doesn't have room
         *  for it without crowding the title. */}
        <span
          aria-hidden
          className="border-foreground/25 text-foreground/70 absolute top-4 right-4 hidden h-7 w-7 items-center justify-center rounded-full border font-mono text-[10px] sm:inline-flex"
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
              className="from-primary/0 via-primary/50 to-primary/0 hidden h-px w-12 bg-gradient-to-r transition-all duration-500 group-hover:w-24 sm:block"
            />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
