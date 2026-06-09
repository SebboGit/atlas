import { notFound } from 'next/navigation';

import { continuationsByDayKey } from '@/components/features/segments/continuations';
import { classifyDays } from '@/components/features/segments/day-temporal';
import { GeocodePoller } from '@/components/features/segments/geocode-poller';
import {
  countDaysInclusive,
  fillDayRange,
  groupSegmentsByDay,
  surfaceUndatedOnItinerary,
} from '@/components/features/segments/group-by-day';
import {
  ItineraryDayList,
  type ItineraryDay,
} from '@/components/features/segments/itinerary-day-list';
import { ItineraryEmpty } from '@/components/features/segments/itinerary-empty';
import { ItineraryUndated } from '@/components/features/segments/itinerary-undated';
import { SegmentFormDialog } from '@/components/features/segments/segment-form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import * as documentsRepo from '@/lib/documents/repo';
import { getPlaceCoordsView } from '@/lib/geocoding';
import * as segmentsRepo from '@/lib/segments/repo';
import * as tripsRepo from '@/lib/trips/repo';

interface ItineraryPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string | string[] }>;
}

export default async function ItineraryPage({ params, searchParams }: ItineraryPageProps) {
  const user = await requireUser();
  const { id } = await params;
  // Next.js hands repeated query params (?country=a&country=b) as an array;
  // collapse to the first so a hand-edited URL can't throw. Matches the
  // Activities / Food tabs.
  const { country: rawCountry } = await searchParams;
  const country = Array.isArray(rawCountry) ? rawCountry[0] : rawCountry;

  // Re-fetched here in addition to the layout's fetch — this page needs
  // the trip summary too. getByIdForUser is React.cache-wrapped, so the
  // layout's lookup and this one collapse to a single query per request.
  const trip = await tripsRepo.getByIdForUser(user.id, id);
  if (!trip) notFound();

  const [datedSegments, undatedSegments, linkedDocsBySegment] = await Promise.all([
    segmentsRepo.listForTrip(user.id, id, {
      countryCode: country?.toUpperCase(),
      scheduled: true,
    }),
    segmentsRepo.listForTrip(user.id, id, {
      countryCode: country?.toUpperCase(),
      scheduled: false,
    }),
    documentsRepo.listLinkedDocumentsByTripSegment(user.id, id),
  ]);

  // Undated note / transit segments have no dedicated tab, so an undated
  // one would be invisible everywhere without this. Undated activities /
  // food deliberately live on their own flat tabs (ADR-0003), so they're
  // excluded — only the "homeless" types surface in the itinerary's
  // Undated section. The predicate lives in group-by-day.ts so it's tested.
  const undatedSurfaced = surfaceUndatedOnItinerary(undatedSegments);

  // Coordinates feed the Plus Code badge on each card. Reads the
  // geocode_cache only — never enqueues fetches; absent rows just
  // mean no badge yet (cache miss surfaces on the trip map's "Not
  // pinned" disclosure separately). `pendingCount` is the number of
  // geocodable segments whose cache row hasn't landed yet — the
  // poller below uses it to silently refresh until they do. Covers the
  // undated card too (a transit can be geocoded).
  const { coordsById: coordsBySegmentId, pendingCount } = await getPlaceCoordsView([
    ...datedSegments,
    ...undatedSurfaced,
  ]);

  // `scheduled: true` keeps the day buckets dated-only; the undated
  // surfaced segments render in their own section below. The buckets are
  // then expanded to the trip's full calendar span so every day renders
  // — a mid-stay day with nothing scheduled is still a trip day, and day
  // numbers count real days, not just days that happen to hold segments.
  const { days } = groupSegmentsByDay(datedSegments);
  const filledDays = fillDayRange(days, { start: trip.startDate, end: trip.endDate });
  const hasCountryFilter = !!country;

  // The day-count pill reads the trip's real span. With no dated
  // segments the filled list is empty (the itinerary shows its empty
  // state instead of bare day headers), so fall back to the trip dates.
  const dayCount = filledDays.length || (countDaysInclusive(trip.startDate, trip.endDate) ?? 0);

  // Classify each day relative to "now" on the server so the markup the
  // client hydrates already knows which days are past / today / future.
  // The collapsed-past-days behaviour (which days start folded) is
  // derived from this — see ItineraryDayList.
  const classified = classifyDays(filledDays, new Date());
  const allDays: ItineraryDay[] = classified.map((day) => ({
    // The bucket's UTC calendar-day token (see `groupSegmentsByDay`).
    // Timezone-stable `YYYY-MM-DD` — a UTC ISO instant reparsed on a
    // client in a different timezone than the server can render the
    // wrong calendar day; this token always parses as a local date.
    key: day.key,
    dateKey: day.key,
    dayNumber: day.dayNumber,
    position: day.position,
    segments: day.segments,
  }));

  // The country filter is a focused lens: keep the calendar-true day
  // numbers (assigned above from the full filled span) but drop the days
  // it leaves with nothing — a filtered view full of "No plans" lines
  // for the days spent in the OTHER country would be noise, and "No
  // plans" would be wrong besides. A day counts as having content when
  // it holds a matching segment or a matching stay spans it.
  const itineraryDays = hasCountryFilter
    ? (() => {
        const spanned = continuationsByDayKey(allDays);
        return allDays.filter((day) => day.segments.length > 0 || spanned.has(day.key));
      })()
    : allDays;

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
        <Badge variant="primary" className="border-primary/60 text-xs tracking-[0.16em]">
          {dayCount} {dayCount === 1 ? 'day' : 'days'}
        </Badge>
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

      {itineraryDays.length === 0 && undatedSurfaced.length === 0 ? (
        <ItineraryEmpty hasCountryFilter={hasCountryFilter} />
      ) : (
        <>
          {/* For an `active` trip, every past day folds into a single
           *  collapsed group, today auto-scrolls into focus, and future
           *  days stay visible. Any other status renders plainly — every
           *  day expanded, no collapse, no auto-scroll — since `active` is
           *  the only status where past / today / future coexist. The
           *  collapse interaction and its localStorage persistence live in
           *  this client component; data fetching above stays on the server. */}
          {itineraryDays.length > 0 && (
            <ItineraryDayList
              tripId={id}
              days={itineraryDays}
              isActive={trip.status === 'active'}
              linkedDocumentsBySegment={linkedDocsBySegment}
              coordsBySegmentId={coordsBySegmentId}
            />
          )}

          {/* Undated note / transit — no day to file under, so they sit
           *  after the timeline as a quiet appendix. Renders nothing when
           *  empty. */}
          <ItineraryUndated
            segments={undatedSurfaced}
            tripId={id}
            linkedDocumentsBySegment={linkedDocsBySegment}
            coordsBySegmentId={coordsBySegmentId}
          />
        </>
      )}

      <GeocodePoller pending={pendingCount} />
    </>
  );
}
