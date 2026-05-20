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

interface HotelsTabPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string }>;
}

export default async function HotelsTabPage({ params, searchParams }: HotelsTabPageProps) {
  const user = await requireUser();
  const { id } = await params;
  const { country } = await searchParams;

  const trip = await tripsRepo.getByIdForUser(user.id, id);
  if (!trip) notFound();

  const [hotels, linkedDocsBySegment] = await Promise.all([
    segmentsRepo.listForTrip(user.id, id, {
      type: 'hotel',
      countryCode: country?.toUpperCase(),
    }),
    documentsRepo.listLinkedDocumentsByTripSegment(user.id, id),
  ]);

  const { days, unscheduled } = groupSegmentsByDay(hotels);

  const addButton = (
    <SegmentFormDialog
      tripId={id}
      defaultType="hotel"
      trigger={<Button size="sm">+ Add hotel</Button>}
    />
  );

  return (
    <>
      <TabHeader eyebrow="Hotels" count={hotels.length} action={addButton} />

      {hotels.length === 0 ? (
        <TabEmpty
          title="No stays yet."
          hint="One row per property. Nights are derived from check-in and check-out."
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
