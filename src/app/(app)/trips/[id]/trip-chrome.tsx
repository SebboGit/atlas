'use client';

import { Map as MapIcon, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { DocumentUploadDialog } from '@/components/features/documents/document-upload-dialog';
import { useSegmentScrollFlash } from '@/components/features/segments/use-segment-scroll-flash';
import { DeleteTripDialog } from '@/components/features/trips/delete-trip-dialog';
import { TripFilterBar } from '@/components/features/trips/trip-filter-bar';
import { TripFormDialog } from '@/components/features/trips/trip-form-dialog';
import { TripStatusBadge } from '@/components/features/trips/trip-status-badge';
import { TripTabs } from '@/components/features/trips/trip-tabs';
import { UnarchiveButton } from '@/components/features/trips/unarchive-button';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { unarchiveTripAction } from '@/lib/trips/actions';
import type { Trip } from '@/lib/trips/repo';
import { cn } from '@/lib/utils';

interface TripChromeProps {
  trip: Trip;
  countries: { code: string; name: string }[];
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
export function TripChrome({ trip, countries, attachedDocumentCount, children }: TripChromeProps) {
  const pathname = usePathname();
  const isMapView = pathname === `/trips/${trip.id}/map`;
  const isArchived = trip.status === 'archived';
  const hasFilterBar = countries.length >= 2;
  const dateRange = formatDateRange(trip.startDate, trip.endDate);

  // Cmd+K palette deep-links into segment rows via `#seg-<id>`. The hook
  // lives once at the chrome level so it survives sibling-tab navigation.
  useSegmentScrollFlash();

  return (
    <main
      className={cn(
        'mx-auto w-full px-6 pb-24 sm:px-8',
        isMapView ? 'max-w-6xl pt-6 sm:pt-10' : 'max-w-5xl pt-6 sm:pt-16',
      )}
    >
      {isMapView ? (
        <>
          <div className="atlas-rise mb-5" style={{ animationDelay: '40ms' }}>
            <Link
              href={`/trips/${trip.id}/itinerary`}
              className="text-foreground/70 hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
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
          <div className="atlas-rise mb-5 sm:mb-8" style={{ animationDelay: '40ms' }}>
            <Link
              href="/trips"
              className="text-foreground/70 hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
            >
              <span aria-hidden>←</span>
              <span>All trips</span>
            </Link>
          </div>

          <header className="atlas-rise mb-6 sm:mb-8" style={{ animationDelay: '100ms' }}>
            {/* Eyebrow + status — laptop only. On phone the status pill
             *  moves into the title row (next to the ⋯ menu) to spend one
             *  fewer vertical line before the tabs. */}
            <div className="mb-4 hidden items-center gap-3 sm:flex">
              <p className="text-muted-foreground flex items-center gap-3 font-mono text-[10px] tracking-[0.28em] uppercase">
                <span aria-hidden className="bg-foreground/30 h-px w-8" />
                <span>Trip</span>
              </p>
              <TripStatusBadge status={trip.status} />
            </div>

            {/* Title row — phone tucks the status pill and a ⋯ overflow menu
             *  to the right of the title (Upload / Edit / Archive / Delete);
             *  laptop hides both — the badge sits in the eyebrow row above
             *  and the actions in the inline row below. */}
            <div className="flex items-start gap-3">
              <h1 className="font-display text-foreground flex-1 text-4xl leading-[1.04] font-medium tracking-tight sm:text-6xl">
                {trip.title}
              </h1>
              <div className="mt-1 shrink-0 sm:hidden">
                <TripStatusBadge status={trip.status} />
              </div>
              <TripOverflowMenu
                trip={trip}
                isArchived={isArchived}
                attachedDocumentCount={attachedDocumentCount}
              />
            </div>

            <p className="text-muted-foreground mt-3 font-mono text-xs tracking-wider sm:mt-4">
              {dateRange}
            </p>

            {/* Phone action row — Map is the only inline primary; the
             *  other maintenance actions live in the ⋯ menu above. */}
            <div className="mt-5 sm:hidden">
              <Link
                href={`/trips/${trip.id}/map`}
                className={cn(buttonVariants({ variant: 'ink', size: 'sm' }), 'inline-flex')}
              >
                <MapIcon className="size-3.5" strokeWidth={1.75} />
                <span>View map</span>
              </Link>
            </div>

            {/* Laptop action row — kept as the previous inline strip.
             *  Delete-forever is normalised to outline + destructive tint
             *  so it carries the same visual weight as its peers; the
             *  bare-text variant was a phone-only special case at most. */}
            <div className="mt-7 hidden flex-wrap items-center gap-3 sm:flex">
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
                    variant="outline"
                    size="sm"
                    className="border-destructive/30 text-destructive hover:bg-destructive/8 hover:text-destructive"
                  >
                    Delete forever
                  </Button>
                }
              />
            </div>
          </header>

          <div className="atlas-rule mb-5 sm:mb-6" aria-hidden />

          <div
            className="atlas-rise mb-6 flex flex-col gap-4 sm:mb-10"
            style={{ animationDelay: '180ms' }}
          >
            <TripTabs tripId={trip.id} />
            {hasFilterBar && <TripFilterBar countries={countries} />}
          </div>
        </>
      )}

      {children}
    </main>
  );
}

// Phone overflow menu — Radix DropdownMenu with menu items that drive
// sibling dialogs via controlled `open` state. Lifting the state out of
// the dialog components avoids stacking DropdownMenuItem + DialogTrigger
// in an asChild composition (which would clone `aria-haspopup="dialog"`
// onto a `role="menuitem"` and break focus restore on dialog close —
// the menu item unmounts before the dialog can hand focus back to it).
// The trigger button is sm:hidden so it never renders on laptop where
// the inline action row carries the same actions.
function TripOverflowMenu({
  trip,
  isArchived,
  attachedDocumentCount,
}: {
  trip: Trip;
  isArchived: boolean;
  attachedDocumentCount: number;
}) {
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [restorePending, startRestore] = React.useTransition();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Trip actions"
            className="size-11 shrink-0 sm:hidden"
          >
            <MoreHorizontal className="size-5" strokeWidth={1.75} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setUploadOpen(true);
            }}
          >
            Upload document
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setEditOpen(true);
            }}
          >
            Edit trip
          </DropdownMenuItem>
          {isArchived ? (
            <DropdownMenuItem
              disabled={restorePending}
              onSelect={() =>
                startRestore(() => unarchiveTripAction(trip.id).then(() => undefined))
              }
            >
              {restorePending ? 'Restoring…' : 'Restore from archive'}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setArchiveOpen(true);
              }}
            >
              Archive trip
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setDeleteOpen(true);
            }}
          >
            Delete forever
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DocumentUploadDialog tripId={trip.id} open={uploadOpen} onOpenChange={setUploadOpen} />
      <TripFormDialog mode="edit" trip={trip} open={editOpen} onOpenChange={setEditOpen} />
      {!isArchived && (
        <DeleteTripDialog
          tripId={trip.id}
          tripTitle={trip.title}
          mode="archive"
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
        />
      )}
      <DeleteTripDialog
        tripId={trip.id}
        tripTitle={trip.title}
        mode="delete"
        attachedDocumentCount={attachedDocumentCount}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
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
