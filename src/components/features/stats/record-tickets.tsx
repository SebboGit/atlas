import { BedDouble, Plane, PlaneLanding } from 'lucide-react';
import Link from 'next/link';

import { SEGMENT_TONE } from '@/components/features/segments/segment-tone';
import { Card } from '@/components/ui/card';
import type { PersonalRecords } from '@/lib/stats';
import { plural } from '@/lib/stats/format';
import { airportPlace } from '@/lib/stats/places';
import { cn } from '@/lib/utils';

import { LatitudeTicket } from './latitude-ticket';
import { SECTION_HEADING, STRIP_LABEL } from './styles';

/**
 * Personal records as tickets, toned by the segment they come from:
 * longest trip in the hotel tone, airport and airline in the flight tone,
 * the latitude span on the inverse surface. A record with no data yet is
 * left out and the rest close ranks. Phone: stubs run across the top
 * (the approved small-caps labels), the longest trip full width and the
 * airport and airline side by side. From `sm:` the stubs move to the left
 * with the figure on them, two to a row, three from `lg:`.
 */
export function RecordTickets({ records }: { records: PersonalRecords }) {
  const { longestTrip, mostVisitedAirport: airport, topAirline: airline } = records;
  const flightCount = (airport ? 1 : 0) + (airline ? 1 : 0);
  const count = flightCount + (longestTrip ? 1 : 0);
  const hasLatitude = records.northernmost !== null || records.southernmost !== null;
  if (count === 0 && !hasLatitude) return null;

  // Spans per ticket: a lone ticket in its row takes the full width.
  const longestSpan =
    count === 3
      ? 'col-span-2 lg:col-span-1'
      : count === 2
        ? 'col-span-2 sm:col-span-1'
        : 'col-span-2';
  const flightSpan =
    flightCount === 1 && count === 1
      ? 'col-span-2'
      : flightCount === 1
        ? 'col-span-2 sm:col-span-1'
        : 'col-span-1';
  const airportWhere = airport ? airportPlace(airport.code) : null;

  return (
    <section aria-labelledby="stats-records">
      <h2 id="stats-records" className={SECTION_HEADING}>
        Records
      </h2>
      <div className="flex flex-col gap-3 sm:gap-4">
        {count > 0 && (
          <div className={cn('grid grid-cols-2 gap-3 sm:gap-4', count === 3 && 'lg:grid-cols-3')}>
            {longestTrip && (
              <RecordTicket
                className={longestSpan}
                tone={SEGMENT_TONE.hotel}
                glyph={<BedDouble />}
                stripLabel="Longest trip"
                figure={String(longestTrip.nights)}
                figureWord={plural(longestTrip.nights, 'night')}
              >
                <span className="text-muted-foreground hidden text-base sm:block">
                  Longest trip
                </span>
                {/* Stretched over the whole ticket, so the tap target is the
                 *  card; the underline says it's a link without a hover. */}
                <Link
                  href={`/trips/${longestTrip.tripId}`}
                  className="decoration-foreground/30 hover:text-coral-ink hover:decoration-coral-ink focus-visible:after:ring-ring text-[1.3125rem] leading-[1.15] font-bold tracking-[-0.02em] break-words underline decoration-2 underline-offset-4 after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset sm:text-2xl"
                >
                  {longestTrip.title}
                </Link>
              </RecordTicket>
            )}
            {airport && (
              <RecordTicket
                className={flightSpan}
                tone={SEGMENT_TONE.flight}
                glyph={<PlaneLanding />}
                stripLabel="Airport"
                figure={String(airport.visits)}
                figureWord={plural(airport.visits, 'visit')}
                compactStrip
              >
                <span className="text-muted-foreground hidden text-base sm:block">
                  Most-visited airport
                </span>
                <span className="text-[1.625rem] leading-[1.05] font-bold tracking-[-0.02em] sm:text-2xl sm:leading-[1.15]">
                  {airport.code}
                </span>
                {/* The city (else the country) on phone and laptop alike; the
                 *  phone adds the visit count the laptop carries on its stub. */}
                {airportWhere && (
                  <span className="text-muted-foreground truncate text-[0.8125rem] sm:text-[0.9375rem]">
                    {airportWhere}
                  </span>
                )}
                <span className="text-muted-foreground text-[0.8125rem] sm:hidden">
                  {airport.visits} {plural(airport.visits, 'visit')}
                </span>
              </RecordTicket>
            )}
            {airline && (
              <RecordTicket
                className={flightSpan}
                tone={SEGMENT_TONE.flight}
                glyph={<Plane />}
                stripLabel="Airline"
                figure={String(airline.flights)}
                figureWord={plural(airline.flights, 'flight')}
                compactStrip
              >
                <span className="text-muted-foreground hidden text-base sm:block">Top airline</span>
                <span className="text-xl leading-[1.3] font-bold tracking-[-0.02em] break-words sm:text-2xl sm:leading-[1.15]">
                  {airline.name}
                </span>
                <span className="text-muted-foreground text-[0.8125rem] sm:hidden">
                  {airline.flights} {plural(airline.flights, 'flight')}
                </span>
              </RecordTicket>
            )}
          </div>
        )}
        {hasLatitude && (
          <LatitudeTicket south={records.southernmost} north={records.northernmost} />
        )}
      </div>
    </section>
  );
}

function RecordTicket({
  tone,
  glyph,
  stripLabel,
  figure,
  figureWord,
  compactStrip = false,
  className,
  children,
}: {
  tone: string;
  glyph: React.ReactNode;
  stripLabel: string;
  figure: string;
  figureWord: string;
  /** Half-width phone tickets: the strip carries only the label. */
  compactStrip?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      variant="paper"
      className={cn(
        'relative flex flex-col overflow-hidden sm:min-h-[9.75rem] sm:flex-row',
        className,
      )}
    >
      <div
        className={cn(
          'ticket-stub flex shrink-0 items-center justify-between gap-3 sm:w-36 sm:flex-col sm:items-start sm:px-[1.125rem] sm:py-5',
          compactStrip ? 'h-11 px-3.5' : 'h-12 px-4',
          'sm:h-auto',
          tone,
        )}
      >
        <span className={cn(STRIP_LABEL, 'sm:hidden [&_svg]:size-3.5')}>
          <span aria-hidden className="contents">
            {glyph}
          </span>
          {stripLabel}
        </span>
        {!compactStrip && (
          <span className="text-xl font-bold sm:hidden">
            {figure}
            <span className={cn(STRIP_LABEL, 'ml-1 inline')}>{figureWord}</span>
          </span>
        )}
        <span aria-hidden className="hidden sm:block [&_svg]:size-[22px] [&_svg]:stroke-[1.75]">
          {glyph}
        </span>
        <div className="hidden sm:block">
          <p className="text-[2.5rem] leading-none font-bold tracking-[-0.03em]">{figure}</p>
          <p className="mt-1 text-base font-semibold">{figureWord}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-3.5 pt-3 pb-3.5 sm:gap-2 sm:px-[1.375rem] sm:py-5">
        {children}
      </div>
    </Card>
  );
}
