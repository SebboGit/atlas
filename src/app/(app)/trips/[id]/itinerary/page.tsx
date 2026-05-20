import { notFound } from 'next/navigation';

import { DayGroup } from '@/components/features/segments/day-group';
import { groupSegmentsByDay } from '@/components/features/segments/group-by-day';
import { ItineraryEmpty } from '@/components/features/segments/itinerary-empty';
import { SegmentFormDialog } from '@/components/features/segments/segment-form-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import * as documentsRepo from '@/lib/documents/repo';
import * as segmentsRepo from '@/lib/segments/repo';
import * as tripsRepo from '@/lib/trips/repo';

interface ItineraryPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string }>;
}

export default async function ItineraryPage({ params, searchParams }: ItineraryPageProps) {
  const user = await requireUser();
  const { id } = await params;
  const { country } = await searchParams;

  // Re-fetched here in addition to the layout's fetch. The layout
  // already 404'd on missing, but this page also needs the summary.
  // The lookup is by primary key — cheap; revisit with React cache()
  // if it ever shows up in a flamegraph.
  const trip = await tripsRepo.getByIdForUser(user.id, id);
  if (!trip) notFound();

  const [segments, linkedDocsBySegment] = await Promise.all([
    segmentsRepo.listForTrip(user.id, id, {
      countryCode: country?.toUpperCase(),
      scheduled: true,
    }),
    documentsRepo.listLinkedDocumentsByTripSegment(user.id, id),
  ]);

  // `scheduled: true` filter above guarantees no unscheduled bucket here.
  const { days } = groupSegmentsByDay(segments);
  const hasCountryFilter = !!country;

  return (
    <>
      {/* Trip summary lives on the itinerary tab — it's the overview
       *  surface, and the type-specific tabs are laser-focused. */}
      {trip.summary && (
        <Card
          variant="paper"
          className="atlas-rise mb-8 overflow-hidden"
          style={{ animationDelay: '240ms' }}
        >
          <CardContent className="px-6 py-6 sm:px-7 sm:py-7">
            <p className="text-foreground/55 mb-3 font-mono text-[10px] tracking-[0.28em] uppercase">
              Summary
            </p>
            <p className="text-foreground/85 text-base leading-relaxed sm:text-[17px]">
              {trip.summary}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Itinerary header — eyebrow with day count + Add segment CTA.
       *  Renders even when the itinerary is empty so the user always
       *  has a way to start. */}
      <header
        className="atlas-rise mb-6 flex flex-wrap items-center gap-3"
        style={{ animationDelay: '260ms' }}
      >
        <p className="text-foreground/70 font-mono text-[10px] tracking-[0.28em] uppercase">
          Itinerary
        </p>
        <span className="text-foreground/40 font-mono text-[10px] tracking-[0.2em]">
          · {String(days.length).padStart(2, '0')} {days.length === 1 ? 'day' : 'days'}
        </span>
        <span aria-hidden className="bg-foreground/15 hidden h-px flex-1 sm:block" />
        <SegmentFormDialog
          tripId={id}
          trigger={
            <Button size="sm" variant="outline" className="ml-auto sm:ml-0">
              + Add segment
            </Button>
          }
        />
      </header>

      {days.length === 0 ? (
        <ItineraryEmpty hasCountryFilter={hasCountryFilter} />
      ) : (
        <div>
          {days.map((day, i) => (
            <div
              key={day.date.toISOString()}
              className="atlas-rise"
              style={{ animationDelay: `${300 + i * 60}ms` }}
            >
              <DayGroup
                dayNumber={i + 1}
                date={day.date}
                segments={day.segments}
                tripId={id}
                linkedDocumentsBySegment={linkedDocsBySegment}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
