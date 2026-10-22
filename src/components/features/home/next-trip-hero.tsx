import Link from 'next/link';

import type { Trip } from '@/lib/trips';
import { formatTripDateRange, toYmd } from '@/lib/trips/format';

import { TripCountdown } from './trip-countdown';

// The signature home element: the trip you're on, or the next one up,
// rendered as a wide bookplate with a coral countdown. Fed by the
// same tripsRepo + partitionForDashboard the trips page already uses.

export function NextTripHero({ trip }: { trip: Trip }) {
  const range = formatTripDateRange(trip.startDate, trip.endDate);

  return (
    <Link
      href={{ pathname: `/trips/${trip.id}` }}
      className="atlas-rise group focus-visible:ring-ring focus-visible:ring-offset-background block rounded-[1.75rem] transition-opacity focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none [@media(hover:hover)]:hover:opacity-95"
      style={{ animationDelay: '220ms' }}
    >
      {/* The inverse surface marks "now / next" in both themes — ink in
       *  light mode, near-white in dark. Split like a ticket: identity on
       *  the left, the countdown on a perforated stub to the right. */}
      <div className="bg-inverse text-inverse-foreground flex flex-col overflow-hidden rounded-[1.75rem] sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3 px-6 py-7 sm:px-8 sm:py-8">
          <span className="bg-primary text-primary-foreground self-start rounded-full px-3 py-1 text-xs font-bold">
            {trip.status === 'active' ? 'Travelling now' : 'Next departure'}
          </span>
          <h2 className="font-display text-4xl leading-[0.95] tracking-tight break-words sm:text-6xl">
            {trip.title}
          </h2>
          <p className="text-inverse-muted font-mono text-xs tracking-[0.06em] uppercase">
            {range}
          </p>
          {trip.summary && (
            <p className="text-inverse-muted line-clamp-2 max-w-prose text-sm leading-relaxed">
              {trip.summary}
            </p>
          )}
        </div>

        {/* Countdown — computed in the viewer's timezone (resolves on mount). */}
        <div className="border-inverse-line flex shrink-0 items-center border-t-2 border-dashed px-6 py-5 sm:w-64 sm:border-t-0 sm:border-l-2 sm:px-8 sm:py-8">
          <TripCountdown
            status={trip.status}
            startYmd={trip.startDate ? toYmd(trip.startDate) : null}
          />
        </div>
      </div>
    </Link>
  );
}
