import Link from 'next/link';

import { TripStatusBadge } from '@/components/features/trips/trip-status-badge';
import { Card, CardContent } from '@/components/ui/card';
import type { Trip } from '@/lib/trips';
import { formatTripDateRange, toYmd } from '@/lib/trips/format';

import { TripCountdown } from './trip-countdown';

// The signature home element: the trip you're on, or the next one up,
// rendered as a wide bookplate with a terracotta countdown. Fed by the
// same tripsRepo + partitionForDashboard the trips page already uses.

export function NextTripHero({ trip, index = '01' }: { trip: Trip; index?: string }) {
  const range = formatTripDateRange(trip.startDate, trip.endDate);

  return (
    <Link
      href={{ pathname: `/trips/${trip.id}` }}
      className="atlas-rise group focus-visible:ring-primary/40 focus-visible:ring-offset-background block rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      style={{ animationDelay: '220ms' }}
    >
      <Card
        variant="glass"
        className="relative overflow-hidden transition-transform duration-500 hover:-translate-y-0.5"
      >
        <span
          aria-hidden
          className="border-primary/40 text-primary/80 absolute top-5 right-5 inline-flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[10px]"
        >
          {index}
        </span>

        <CardContent className="flex flex-col gap-6 px-6 py-7 sm:flex-row sm:items-stretch sm:gap-10 sm:px-8 sm:py-8">
          {/* Trip identity */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="text-primary font-mono text-[10px] tracking-[0.28em] uppercase">
              Next departure
            </p>
            <h2 className="font-display text-foreground text-3xl leading-tight font-medium tracking-tight sm:text-4xl">
              {trip.title}
            </h2>
            <p className="text-foreground/70 font-mono text-[11px] tracking-[0.18em] uppercase">
              {range}
            </p>
            {trip.summary && (
              <p className="text-muted-foreground line-clamp-2 max-w-prose text-sm leading-relaxed">
                {trip.summary}
              </p>
            )}
            <div className="mt-auto pt-2">
              <TripStatusBadge status={trip.status} />
            </div>
          </div>

          {/* Countdown — the focal terracotta moment, computed in the
           *  viewer's timezone (resolves on mount). */}
          <TripCountdown
            status={trip.status}
            startYmd={trip.startDate ? toYmd(trip.startDate) : null}
          />
        </CardContent>

        <span
          aria-hidden
          className="from-primary/0 via-primary/60 to-primary/0 absolute right-8 bottom-6 hidden h-px w-12 bg-gradient-to-r transition-all duration-500 group-hover:w-28 sm:block"
        />
      </Card>
    </Link>
  );
}
