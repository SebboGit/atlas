import { notFound } from 'next/navigation';

import { DateGroup } from '@/components/features/segments/date-group';
import { GeocodePoller } from '@/components/features/segments/geocode-poller';
import { groupSegmentsByDay } from '@/components/features/segments/group-by-day';
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

// Dual-state surface — scheduled activities first, wishlist below.
// Both share the same `activities` segment type; the discriminator is
// `startsAt` being null (wishlist) or set (scheduled). See ADR-0003.
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

  // Fetch both states in one query and split client-side. Cheap, and
  // saves a round-trip.
  const [all, linkedDocsBySegment, tripCountries] = await Promise.all([
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
    getPlaceCoordsView(all),
  ]);

  const scheduled = all.filter((a) => a.startsAt !== null);
  const wishlist = all.filter((a) => a.startsAt === null);
  const { days: scheduledDays } = groupSegmentsByDay(scheduled);

  const addButton = (
    <SegmentFormDialog
      tripId={id}
      defaultType="activity"
      trigger={<Button size="sm">+ Add activity</Button>}
    />
  );

  return (
    <>
      <TabHeader eyebrow="Activities" count={all.length} action={addButton} />

      <WishlistSuggestionsPanel tripId={id} items={suggestions} />

      {all.length === 0 ? (
        <TabEmpty
          title="No activities yet."
          hint="Add one with no date, or schedule it for a specific day."
          action={addButton}
        />
      ) : (
        <div className="atlas-rise flex flex-col gap-10" style={{ animationDelay: '300ms' }}>
          <section>
            <SubsectionHeader label="Scheduled" count={scheduled.length} />
            {scheduled.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                None scheduled — pick a date on a wishlist card to move it here.
              </p>
            ) : (
              <div>
                {scheduledDays.map((day) => (
                  <DateGroup
                    key={day.date.toISOString()}
                    date={day.date}
                    segments={day.segments}
                    tripId={id}
                    linkedDocumentsBySegment={linkedDocsBySegment}
                    coordsBySegmentId={coordsBySegmentId}
                    showScheduleAction
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <SubsectionHeader label="Unscheduled" count={wishlist.length} />
            {wishlist.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing unscheduled yet. Add an activity without a date to drop it here.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {wishlist.map((a) => (
                  <li key={a.id}>
                    <SegmentRow
                      segment={a}
                      tripId={id}
                      linkedDocuments={linkedDocsBySegment.get(a.id)}
                      coords={coordsBySegmentId.get(a.id) ?? null}
                      showScheduleAction
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <GeocodePoller pending={pendingCount} />
    </>
  );
}

function SubsectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <header className="mb-3 flex items-baseline gap-3 sm:mb-4">
      <p className="text-foreground/65 font-mono text-[10px] tracking-[0.28em] uppercase">
        {label}
      </p>
      <span className="text-foreground/40 font-mono text-[10px] tracking-[0.2em]">
        · {String(count).padStart(2, '0')}
      </span>
      <span aria-hidden className="bg-foreground/15 h-px flex-1" />
    </header>
  );
}
