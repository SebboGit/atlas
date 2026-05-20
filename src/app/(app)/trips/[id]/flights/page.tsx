import { notFound } from 'next/navigation';

import { DateGroup } from '@/components/features/segments/date-group';
import { groupSegmentsByDay } from '@/components/features/segments/group-by-day';
import { SegmentFormDialog } from '@/components/features/segments/segment-form-dialog';
import { TabEmpty } from '@/components/features/segments/tab-empty';
import { TabHeader } from '@/components/features/segments/tab-header';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/session';
import * as documentsRepo from '@/lib/documents/repo';
import * as segmentsRepo from '@/lib/segments/repo';
import * as tripsRepo from '@/lib/trips/repo';

interface FlightsTabPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string }>;
}

export default async function FlightsTabPage({ params, searchParams }: FlightsTabPageProps) {
  const user = await requireUser();
  const { id } = await params;
  const { country } = await searchParams;

  // Layout already 404'd on missing — re-fetching here is the cheapest
  // way to keep this page independent. See itinerary/page.tsx for the
  // same pattern.
  const trip = await tripsRepo.getByIdForUser(user.id, id);
  if (!trip) notFound();

  const [flights, linkedDocsBySegment] = await Promise.all([
    segmentsRepo.listForTrip(user.id, id, {
      type: 'flight',
      countryCode: country?.toUpperCase(),
    }),
    documentsRepo.listLinkedDocumentsByTripSegment(user.id, id),
  ]);

  const { days, unscheduled } = groupSegmentsByDay(flights);

  const addButton = (
    <SegmentFormDialog
      tripId={id}
      defaultType="flight"
      trigger={<Button size="sm">+ Add flight</Button>}
    />
  );

  return (
    <>
      <TabHeader eyebrow="Flights" count={flights.length} action={addButton} />

      {flights.length === 0 ? (
        <TabEmpty
          title="No flights yet."
          hint="Add the inbound and outbound legs, plus any connections. Carrier and PNR are nice-to-have."
          action={addButton}
        />
      ) : (
        <div className="atlas-rise" style={{ animationDelay: '300ms' }}>
          {days.map((day) => (
            <DateGroup
              key={day.date.toISOString()}
              date={day.date}
              segments={day.segments}
              tripId={id}
              linkedDocumentsBySegment={linkedDocsBySegment}
            />
          ))}
          {unscheduled.length > 0 && (
            <DateGroup
              date={null}
              segments={unscheduled}
              tripId={id}
              linkedDocumentsBySegment={linkedDocsBySegment}
            />
          )}
        </div>
      )}
    </>
  );
}
