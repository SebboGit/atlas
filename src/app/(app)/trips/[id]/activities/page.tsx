import { notFound } from 'next/navigation';

import { DateGroup } from '@/components/features/segments/date-group';
import { GeocodePoller } from '@/components/features/segments/geocode-poller';
import { groupSegmentsByDay } from '@/components/features/segments/group-by-day';
import { SegmentFormDialog } from '@/components/features/segments/segment-form-dialog';
import { SegmentRow } from '@/components/features/segments/segment-row';
import { TabEmpty } from '@/components/features/segments/tab-empty';
import { TabHeader } from '@/components/features/segments/tab-header';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/session';
import * as documentsRepo from '@/lib/documents/repo';
import { getPlaceCoordsView } from '@/lib/geocoding';
import * as segmentsRepo from '@/lib/segments/repo';
import * as tripsRepo from '@/lib/trips/repo';

interface ActivitiesTabPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string }>;
}

// Dual-state surface — scheduled activities first, wishlist below.
// Both share the same `activities` segment type; the discriminator is
// `startsAt` being null (wishlist) or set (scheduled). See ADR-0003.
export default async function ActivitiesTabPage({ params, searchParams }: ActivitiesTabPageProps) {
  const user = await requireUser();
  const { id } = await params;
  const { country } = await searchParams;

  const trip = await tripsRepo.getByIdForUser(user.id, id);
  if (!trip) notFound();

  // Fetch both states in one query and split client-side. Cheap, and
  // saves a round-trip.
  const [all, linkedDocsBySegment] = await Promise.all([
    segmentsRepo.listForTrip(user.id, id, {
      type: 'activity',
      countryCode: country?.toUpperCase(),
    }),
    documentsRepo.listLinkedDocumentsByTripSegment(user.id, id),
  ]);

  const { coordsById: coordsBySegmentId, pendingCount } = await getPlaceCoordsView(all);

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

      {all.length === 0 ? (
        <TabEmpty
          title="No activities yet."
          hint="Add one to your wishlist (no date) or schedule it for a specific day."
          action={addButton}
        />
      ) : (
        <div className="atlas-rise flex flex-col gap-10" style={{ animationDelay: '300ms' }}>
          <section>
            <SubsectionHeader
              label="Scheduled"
              count={scheduled.length}
              hint="Date-ordered. Edits move them in the itinerary."
            />
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
            <SubsectionHeader
              label="Wishlist"
              count={wishlist.length}
              hint="Things to do on this trip, no date yet. Promote with a date."
            />
            {wishlist.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing on the wishlist. Add an activity without a date to drop it here.
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

function SubsectionHeader({ label, count, hint }: { label: string; count: number; hint: string }) {
  return (
    <header className="mb-3 flex flex-col gap-1 sm:mb-4">
      <div className="flex items-baseline gap-3">
        <p className="text-foreground/65 font-mono text-[10px] tracking-[0.28em] uppercase">
          {label}
        </p>
        <span className="text-foreground/40 font-mono text-[10px] tracking-[0.2em]">
          · {String(count).padStart(2, '0')}
        </span>
        <span aria-hidden className="bg-foreground/15 h-px flex-1" />
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </header>
  );
}
