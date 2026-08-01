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

  const [food, linkedDocsBySegment, tripCountries] = await Promise.all([
    segmentsRepo.listForTrip(user.id, id, {
      type: 'food',
      countryCode: country?.toUpperCase(),
    }),
    documentsRepo.listLinkedDocumentsByTripSegment(user.id, id),
    segmentsRepo.listCountryCodesForTrip(user.id, id),
  ]);

  // Suggestions + the added-by names in parallel. `listForCountries`
  // returns [] for an empty country list, so no guard.
  const [suggestions, namesByUserId] = await Promise.all([
    wishlistRepo.listForCountries(tripCountries, {
      type: 'food',
      excludeMaterialisedOnTrip: id,
    }),
    wishlistRepo.listUserDisplayNames(),
  ]);

  // One cache read covering both the segments and the suggestion rows —
  // suggestion coords can only be derived once we have the suggestions,
  // so this can't join the Promise.all above, but merging the two lists
  // keeps it a single geocode_cache round-trip and a single pendingCount
  // for the one poller. Segment and wishlist ids are distinct UUIDs, so
  // the shared map can't collide.
  const { coordsById, pendingCount } = await getPlaceCoordsView([...food, ...suggestions]);

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

      <WishlistSuggestionsPanel
        tripId={id}
        items={suggestions}
        // Nothing else on the tab to act on, so don't make the user
        // click to discover the one thing there is. Gated on there being
        // no country filter: `food` is filtered but the suggestions are
        // not, so a filter that happens to match no food would otherwise
        // auto-expand on a trip that has plenty.
        defaultOpen={food.length === 0 && !country}
        coordsById={coordsById}
        namesByUserId={namesByUserId}
      />

      {food.length === 0 ? (
        <TabEmpty
          title="No food yet."
          hint="Add a reservation with a date, or drop a place you'd like to try with no date — both live here together."
          action={addButton}
        />
      ) : (
        <ul className="atlas-rise grid gap-3 sm:grid-cols-2" style={{ animationDelay: '300ms' }}>
          {/* `min-w-0` on each item: a grid item defaults to `min-width:
           *  auto`, so the track sizes to the card's min-content rather
           *  than the 312px available at 360px wide and the whole page
           *  scrolls sideways (#117). Capping the item lets the card's own
           *  `min-w-0` text column shrink and truncate instead. */}
          {food.map((segment) => (
            <li key={segment.id} className="min-w-0">
              <SegmentRow
                segment={segment}
                tripId={id}
                linkedDocuments={linkedDocsBySegment.get(segment.id)}
                coords={coordsById.get(segment.id) ?? null}
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
