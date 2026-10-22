import Link from 'next/link';

import { Card } from '@/components/ui/card';
import type { Trip } from '@/lib/trips';
import { formatTripCompactRange, formatTripDateRange } from '@/lib/trips/format';
import { cn } from '@/lib/utils';

import { TripStatusBadge } from './trip-status-badge';

// Trip dates are calendar days stored at UTC midnight — read them in UTC so
// the stub never slips a day for a viewer west of Greenwich.
const STUB_MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const STUB_DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' });
const STUB_YEAR = new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: 'UTC' });

// A trip as a ticket: the start date on the stub, the title and summary on
// the body. One layout at every width — the phone just drops the summary
// and uses the compact date range.
export function TripListCard({ trip }: { trip: Trip }) {
  const range = formatTripDateRange(trip.startDate, trip.endDate);
  const compactRange = formatTripCompactRange(trip.startDate, trip.endDate);
  const isArchived = trip.status === 'archived';
  const start = trip.startDate;

  return (
    <Link
      href={{ pathname: `/trips/${trip.id}` }}
      className="atlas-rise group focus-visible:ring-ring focus-visible:ring-offset-background block h-full rounded-[1.25rem] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <Card
        variant="paper"
        className="ticket [@media(hover:hover)]:group-hover:border-foreground/30 flex h-full overflow-hidden rounded-[1.25rem] transition-colors"
      >
        <div
          aria-hidden
          className="ticket-stub-left bg-muted text-foreground flex w-[4.75rem] shrink-0 flex-col items-center justify-center gap-1 px-2 py-4 text-center sm:w-[6.5rem] sm:items-start sm:justify-between sm:px-4 sm:py-5 sm:text-left"
        >
          {start ? (
            <>
              <span className="text-muted-foreground font-mono text-[11px] tracking-[0.06em] uppercase">
                {STUB_MONTH.format(start)}
              </span>
              <span className="font-display text-3xl leading-none sm:text-[2.5rem]">
                {STUB_DAY.format(start)}
              </span>
              <span className="text-muted-foreground font-mono text-[11px]">
                {STUB_YEAR.format(start)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground font-mono text-[11px] tracking-[0.06em] uppercase">
              No dates
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-4 py-4 sm:px-6 sm:py-5">
          <p className="text-muted-foreground font-mono text-[11px] tracking-[0.06em] uppercase">
            <span className="sm:hidden">{compactRange}</span>
            <span className="hidden sm:inline">{range}</span>
          </p>
          <h3
            className={cn(
              'font-display text-xl leading-tight tracking-tight break-words sm:text-2xl',
              isArchived ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {trip.title}
          </h3>
          {trip.summary && (
            <p className="text-muted-foreground line-clamp-2 hidden text-sm leading-relaxed sm:block">
              {trip.summary}
            </p>
          )}
          <div className="mt-auto pt-1">
            <TripStatusBadge status={trip.status} />
          </div>
        </div>
      </Card>
    </Link>
  );
}
