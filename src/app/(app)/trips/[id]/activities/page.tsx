import { notFound } from 'next/navigation';

import { GeocodePoller } from '@/components/features/segments/geocode-poller';
import { SegmentFormDialog } from '@/components/features/segments/segment-form-dialog';
import { SegmentRow } from '@/components/features/segments/segment-row';
import { TabEmpty } from '@/components/features/segments/tab-empty';
import { TabHeader } from '@/components/features/segments/tab-header';
import { WishlistSuggestionsPanel } from '@/components/features/wishlist/wishlist-suggestions-panel';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/session';
import * as documentsRepo from '@/lib/documents/repo';
import { getPlaceCoordsView } from '@/lib/geocoding';
import * as segmentsRepo from '@/lib/segments/repo';
import * as tripsRepo from '@/lib/trips/repo';
import * as wishlistRepo from '@/lib/wishlist/repo';

interface ActivitiesTabPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string | string[] }>;
}

// Flat list of every activity on the trip — dated and undated together,
// no Scheduled/Unscheduled split (matching the Food tab). The itinerary
// is the trip's one chronological view; here each card carries its own
// date+time, and the reschedule affordance sets / changes / clears it.
// An undated activity (null `startsAt`, ADR-0003) simply shows no date.
// `listForTrip` orders `startsAt asc nulls last`, so dated activities
// come first in chronological order and undated ones follow.
export default async function ActivitiesTabPage({ params, searchParams }: ActivitiesTabPageProps) {
  const user = await requireUser();
  const { id } = await params;
  // Next.js hands repeated query params (?country=a&country=b) as an
  // array; collapse to the first so a hand-edited URL can't throw. Matches
  // the Food tab.
  const { country: rawCountry } = await searchParams;
  const country = Array.isArray(rawCountry) ? rawCountry[0] : rawCountry;

  const trip = await tripsRepo.getByIdForUser(user.id, id);
  if (!trip) notFound();

  const [activities, linkedDocsBySegment, tripCountries] = await Promise.all([
    segmentsRepo.listForTrip(user.id, id, {
      type: 'activity',
      countryCode: country?.toUpperCase(),
    }),
    documentsRepo.listLinkedDocumentsByTripSegment(user.id, id),
    segmentsRepo.listCountryCodesForTrip(user.id, id),
  ]);

  // Suggestions (this tab's type) + coords, fetched in parallel.
  const [suggestions, { coordsById: coordsBySegmentId, pendingCount }] = await Promise.all([
    wishlistRepo.listForCountries(tripCountries, {
      type: 'activity',
      excludeMaterialisedOnTrip: id,
    }),
    getPlaceCoordsView(activities),
  ]);

  const addButton = (
    <SegmentFormDialog
      tripId={id}
      defaultType="activity"
      trigger={<Button size="sm">+ Add activity</Button>}
    />
  );

  return (
    <>
      <TabHeader eyebrow="Activities" count={activities.length} action={addButton} />

      <WishlistSuggestionsPanel tripId={id} items={suggestions} />

      {activities.length === 0 ? (
        <TabEmpty
          title="No activities yet."
          hint="Add one with a date, or drop something you'd like to do with no date — both live here together."
          action={addButton}
        />
      ) : (
        <ul className="atlas-rise grid gap-3 sm:grid-cols-2" style={{ animationDelay: '300ms' }}>
          {activities.map((segment) => (
            <li key={segment.id}>
              <SegmentRow
                segment={segment}
                tripId={id}
                linkedDocuments={linkedDocsBySegment.get(segment.id)}
                coords={coordsBySegmentId.get(segment.id) ?? null}
                showScheduleAction
                showDate
              />
            </li>
          ))}
        </ul>
      )}
      <GeocodePoller pending={pendingCount} />
    </>
  );
}
