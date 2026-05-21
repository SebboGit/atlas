import { notFound } from 'next/navigation';

import { SegmentFormDialog } from '@/components/features/segments/segment-form-dialog';
import { SegmentRow } from '@/components/features/segments/segment-row';
import { TabEmpty } from '@/components/features/segments/tab-empty';
import { TabHeader } from '@/components/features/segments/tab-header';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/session';
import * as documentsRepo from '@/lib/documents/repo';
import * as segmentsRepo from '@/lib/segments/repo';
import * as tripsRepo from '@/lib/trips/repo';

interface FoodTabPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string | string[] }>;
}

// Flat list of every food segment on the trip — dated reservations
// and undated "maybe" places together, no Scheduled/Wishlist split.
// The user rarely books restaurants ahead, so food works as an
// in-trip shortlist: one list keeps a dated reservation and an undated
// candidate side by side without forcing a state distinction the user
// doesn't think in. `listForTrip` already orders `startsAt asc nulls
// last`, so dated food comes first in chronological order and undated
// food follows.
export default async function FoodTabPage({ params, searchParams }: FoodTabPageProps) {
  const user = await requireUser();
  const { id } = await params;
  // Next.js hands repeated query params (?country=a&country=b) as an
  // array — take the first value so the toUpperCase() below can't throw.
  const { country: rawCountry } = await searchParams;
  const country = Array.isArray(rawCountry) ? rawCountry[0] : rawCountry;

  const trip = await tripsRepo.getByIdForUser(user.id, id);
  if (!trip) notFound();

  const [food, linkedDocsBySegment] = await Promise.all([
    segmentsRepo.listForTrip(user.id, id, {
      type: 'food',
      countryCode: country?.toUpperCase(),
    }),
    documentsRepo.listLinkedDocumentsByTripSegment(user.id, id),
  ]);

  const addButton = (
    <SegmentFormDialog
      tripId={id}
      defaultType="food"
      trigger={<Button size="sm">+ Add food</Button>}
    />
  );

  return (
    <>
      <TabHeader eyebrow="Food" count={food.length} action={addButton} />

      {food.length === 0 ? (
        <TabEmpty
          title="No food yet."
          hint="Add a reservation with a date, or drop a place you'd like to try with no date — both live here together."
          action={addButton}
        />
      ) : (
        <ul className="atlas-rise grid gap-3 sm:grid-cols-2" style={{ animationDelay: '300ms' }}>
          {food.map((segment) => (
            <li key={segment.id}>
              <SegmentRow
                segment={segment}
                tripId={id}
                linkedDocuments={linkedDocsBySegment.get(segment.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
