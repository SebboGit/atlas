'use client';

import { Map as MapIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { DocumentUploadDialog } from '@/components/features/documents/document-upload-dialog';
import { useSegmentScrollFlash } from '@/components/features/segments/use-segment-scroll-flash';
import { DeleteTripDialog } from '@/components/features/trips/delete-trip-dialog';
import { TripFilterBar } from '@/components/features/trips/trip-filter-bar';
import { TripFormDialog } from '@/components/features/trips/trip-form-dialog';
import { TripStatusBadge } from '@/components/features/trips/trip-status-badge';
import { TripTabs } from '@/components/features/trips/trip-tabs';
import { UnarchiveButton } from '@/components/features/trips/unarchive-button';
import { Button, buttonVariants } from '@/components/ui/button';
import type { Trip } from '@/lib/trips/repo';
import { cn } from '@/lib/utils';

interface TripChromeProps {
  trip: Trip;
  countryCodes: string[];
  attachedDocumentCount: number;
  children: React.ReactNode;
}

/**
 * Switches the trip-detail chrome between two variants:
 *
 *   - **Full**: back chip + header (eyebrow, status, title, dates, action
 *     row) + tabs + (auto) country filter.
 *   - **Focused (map)**: back-to-trip chip + compact title + dates. No
 *     tabs, no action row, no filter — the map below claims the
 *     vertical space.
 *
 * Done client-side via `usePathname` because Next reuses the trip
 * layout across sibling routes (the layout-boundary optimisation —
 * its server code doesn't re-execute on `/itinerary` → `/map`), so a
 * server-side chrome switch would stay stuck on the initial path.
 * The data fetch still happens once on the server.
 */
export function TripChrome({
  trip,
  countryCodes,
  attachedDocumentCount,
  children,
}: TripChromeProps) {
  const pathname = usePathname();
  const isMapView = pathname === `/trips/${trip.id}/map`;
  const isArchived = trip.status === 'archived';
  const hasFilterBar = countryCodes.length >= 2;
  const dateRange = formatDateRange(trip.startDate, trip.endDate);

  // Cmd+K palette deep-links into segment rows via `#seg-<id>`. The hook
  // lives once at the chrome level so it survives sibling-tab navigation.
  useSegmentScrollFlash();

  return (
    <main
      className={cn(
        'mx-auto w-full px-6 pb-24 sm:px-8',
        isMapView ? 'max-w-6xl pt-8 sm:pt-10' : 'max-w-5xl pt-12 sm:pt-16',
      )}
    >
      {isMapView ? (
        <>
          <div className="atlas-rise mb-5" style={{ animationDelay: '40ms' }}>
            <Link
              href={`/trips/${trip.id}/itinerary`}
              className="text-foreground/55 hover:text-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.24em] uppercase transition-colors"
            >
              <span aria-hidden>←</span>
              <span>Back to trip</span>
            </Link>
          </div>

          <header
            className="atlas-rise mb-5 flex flex-wrap items-end justify-between gap-3"
            style={{ animationDelay: '100ms' }}
          >
            <h1 className="font-display text-foreground text-3xl leading-[1.04] font-medium tracking-tight sm:text-4xl">
              {trip.title}
            </h1>
            <p className="text-muted-foreground font-mono text-xs tracking-wider">{dateRange}</p>
          </header>
        </>
      ) : (
        <>
          <div className="atlas-rise mb-8" style={{ animationDelay: '40ms' }}>
            <Link
              href="/trips"
              className="text-foreground/55 hover:text-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.24em] uppercase transition-colors"
            >
              <span aria-hidden>←</span>
              <span>All trips</span>
            </Link>
          </div>

          <header className="atlas-rise mb-8" style={{ animationDelay: '100ms' }}>
            <div className="mb-4 flex items-center gap-3">
              <p className="text-muted-foreground flex items-center gap-3 font-mono text-[10px] tracking-[0.28em] uppercase">
                <span aria-hidden className="bg-foreground/30 h-px w-8" />
                <span>Trip</span>
              </p>
              <TripStatusBadge status={trip.status} />
            </div>

            <h1 className="font-display text-foreground text-5xl leading-[1.04] font-medium tracking-tight sm:text-6xl">
              {trip.title}
            </h1>

            <p className="text-muted-foreground mt-4 font-mono text-xs tracking-wider">
              {dateRange}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <DocumentUploadDialog
                tripId={trip.id}
                trigger={<Button size="sm">+ Upload</Button>}
              />
              {/*
                Render the Link directly with `buttonVariants` instead
                of wrapping it in `<Button asChild>`. The Slot+Link
                composition was shifting React 19's useId sequence
                between server and client by ±2, which cascaded into a
                hydration mismatch downstream in SegmentRow — Radix's
                Dialog uses useId for the trigger/content linkage, and
                the offset caused the Edit and Delete triggers to swap
                IDs. The `ink` variant is the only foreground-on-
                background pill in this row, which is the visual cue
                that "View map" is a perspective switch rather than a
                same-context action like Edit or Archive.
              */}
              <Link
                href={`/trips/${trip.id}/map`}
                className={buttonVariants({ variant: 'ink', size: 'sm' })}
              >
                <MapIcon className="size-3.5" strokeWidth={1.75} />
                <span>View map</span>
              </Link>
              <TripFormDialog
                mode="edit"
                trip={trip}
                trigger={
                  <Button variant="outline" size="sm">
                    Edit trip
                  </Button>
                }
              />
              {isArchived ? (
                <UnarchiveButton tripId={trip.id} />
              ) : (
                <DeleteTripDialog
                  tripId={trip.id}
                  tripTitle={trip.title}
                  mode="archive"
                  trigger={
                    <Button variant="outline" size="sm">
                      Archive
                    </Button>
                  }
                />
              )}
              <DeleteTripDialog
                tripId={trip.id}
                tripTitle={trip.title}
                mode="delete"
                attachedDocumentCount={attachedDocumentCount}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                  >
                    Delete forever
                  </Button>
                }
              />
            </div>
          </header>

          <div className="atlas-rule mb-6" aria-hidden />

          <div className="atlas-rise mb-10 flex flex-col gap-4" style={{ animationDelay: '180ms' }}>
            <TripTabs tripId={trip.id} />
            {hasFilterBar && <TripFilterBar codes={countryCodes} />}
          </div>
        </>
      )}

      {children}
    </main>
  );
}

function formatFullDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateRange(start: Date | null, end: Date | null): string {
  if (start && end) return `${formatFullDate(start)} → ${formatFullDate(end)}`;
  if (start) return `From ${formatFullDate(start)}`;
  if (end) return `Until ${formatFullDate(end)}`;
  return 'Dates to come';
}
