import { notFound } from 'next/navigation';

import { classifyDays } from '@/components/features/segments/day-temporal';
import { GeocodePoller } from '@/components/features/segments/geocode-poller';
import { dayKey, groupSegmentsByDay } from '@/components/features/segments/group-by-day';
import {
  ItineraryDayList,
  type ItineraryDay,
} from '@/components/features/segments/itinerary-day-list';
import { ItineraryEmpty } from '@/components/features/segments/itinerary-empty';
import { SegmentFormDialog } from '@/components/features/segments/segment-form-dialog';
import { WishlistSuggestionsPanel } from '@/components/features/wishlist/wishlist-suggestions-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import * as documentsRepo from '@/lib/documents/repo';
import { getPlaceCoordsView } from '@/lib/geocoding';
import * as segmentsRepo from '@/lib/segments/repo';
import * as tripsRepo from '@/lib/trips/repo';
import * as wishlistRepo from '@/lib/wishlist/repo';

interface ItineraryPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string }>;
}

export default async function ItineraryPage({ params, searchParams }: ItineraryPageProps) {
  const user = await requireUser();
  const { id } = await params;
  const { country } = await searchParams;

  // Re-fetched here in addition to the layout's fetch — this page needs
  // the trip summary too. getByIdForUser is React.cache-wrapped, so the
  // layout's lookup and this one collapse to a single query per request.
  const trip = await tripsRepo.getByIdForUser(user.id, id);
  if (!trip) notFound();

  const [segments, linkedDocsBySegment, tripCountries] = await Promise.all([
    segmentsRepo.listForTrip(user.id, id, {
      countryCode: country?.toUpperCase(),
      scheduled: true,
    }),
    documentsRepo.listLinkedDocumentsByTripSegment(user.id, id),
    // Countries are derived from segment attribution (ADR-0005), not
    // a separate trip_countries row — `trip_countries` exists in the
    // schema but isn't populated anywhere.
    segmentsRepo.listCountryCodesForTrip(user.id, id),
  ]);

  // Coordinates feed the Plus Code badge on each card. Reads the
  // geocode_cache only — never enqueues fetches; absent rows just
  // mean no badge yet (cache miss surfaces on the trip map's "Not
  // pinned" disclosure separately). `pendingCount` is the number of
  // geocodable segments whose cache row hasn't landed yet — the
  // poller below uses it to silently refresh until they do.
  const { coordsById: coordsBySegmentId, pendingCount } = await getPlaceCoordsView(segments);

  // Suggestions panel surfaces wishlist items in this trip's countries
  // that aren't already on this trip. Same item still appears on other
  // trips' panels — see the wishlist-architecture design.
  const wishlistSuggestions =
    tripCountries.length > 0
      ? await wishlistRepo.listForCountries(tripCountries, {
          excludeMaterialisedOnTrip: id,
        })
      : [];

  // `scheduled: true` filter above guarantees no unscheduled bucket here.
  const { days } = groupSegmentsByDay(segments);
  const hasCountryFilter = !!country;

  // Classify each day relative to "now" on the server so the markup the
  // client hydrates already knows which days are past / today / future.
  // The collapsed-past-days behaviour (which days start folded) is
  // derived from this — see ItineraryDayList.
  const classified = classifyDays(days, new Date());
  const itineraryDays: ItineraryDay[] = classified.map((day) => ({
    key: dayKey(day.date),
    // Timezone-stable `YYYY-MM-DD` token. A UTC ISO instant reparsed on
    // a client in a different timezone than the server can render the
    // wrong calendar day — the day token always parses as a local date.
    dateKey: dayKey(day.date),
    dayNumber: day.dayNumber,
    position: day.position,
    segments: day.segments,
  }));

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
            <p className="text-foreground/70 mb-3 font-mono text-[10px] tracking-[0.28em] uppercase">
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

      {itineraryDays.length === 0 ? (
        <ItineraryEmpty hasCountryFilter={hasCountryFilter} />
      ) : (
        // For an `active` trip, every past day folds into a single
        // collapsed group, today auto-scrolls into focus, and future
        // days stay visible. Any other status renders plainly — every
        // day expanded, no collapse, no auto-scroll — since `active` is
        // the only status where past / today / future coexist. The
        // collapse interaction and its localStorage persistence live in
        // this client component; data fetching above stays on the server.
        <ItineraryDayList
          tripId={id}
          days={itineraryDays}
          isActive={trip.status === 'active'}
          linkedDocumentsBySegment={linkedDocsBySegment}
          coordsBySegmentId={coordsBySegmentId}
        />
      )}

      <WishlistSuggestionsPanel tripId={id} items={wishlistSuggestions} />
      <GeocodePoller pending={pendingCount} />
    </>
  );
}
