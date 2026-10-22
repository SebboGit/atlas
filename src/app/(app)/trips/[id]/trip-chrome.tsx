'use client';

import { Lock, Map as MapIcon, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { DocumentUploadDialog } from '@/components/features/documents/document-upload-dialog';
import { useSegmentScrollFlash } from '@/components/features/segments/use-segment-scroll-flash';
import { DeleteTripDialog } from '@/components/features/trips/delete-trip-dialog';
import { TripFilterBar } from '@/components/features/trips/trip-filter-bar';
import { TripFormDialog } from '@/components/features/trips/trip-form-dialog';
import { TripReminderToggle } from '@/components/features/trips/trip-reminder-toggle';
import { TripStatusBadge } from '@/components/features/trips/trip-status-badge';
import { RouteDiagram } from '@/components/features/trips/route-diagram';
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
import { formatTripDateSpan } from '@/lib/trips/format';
import type { RouteStop } from '@/lib/trips/route';
import type { Trip } from '@/lib/trips/repo';
import { cn } from '@/lib/utils';

interface TripChromeProps {
  trip: Trip;
  /**
   * True when the viewer created this trip. Household trips render for
   * every member (ADR-0015), but trip-row actions stay owner-only, so a
   * non-owner sees the read surfaces without the Edit/Archive/Delete/
   * Upload controls.
   */
  isOwner: boolean;
  countries: { code: string; name: string }[];
  attachedDocumentCount: number;
  /**
   * Upload ceiling resolved on the server (`getUploadMaxBytes()`), threaded
   * through because this component is client-side and must not read the
   * environment itself.
   */
  uploadMaxBytes: number;
  /**
   * The viewer's reminder mute for this trip, or null when they get no
   * reminders at all (no ntfy server, or notifications off) — the switch
   * is hidden then. Shown to every member, not just the owner.
   */
  reminders: { muted: boolean } | null;
  /** The trip's stops for the banner's route diagram (empty: no diagram). */
  route: RouteStop[];
  children: React.ReactNode;
}

// Button skins for the inverse banner: a solid pill in the banner's own
// foreground, and an outline that holds on either inverse surface.
const INVERSE_SOLID =
  'bg-inverse-foreground text-inverse hover:bg-inverse-foreground/90 shadow-none';
const INVERSE_OUTLINE =
  'border-inverse-line text-inverse-foreground bg-transparent hover:bg-inverse-foreground/10 hover:text-inverse-foreground';

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
  isOwner,
  countries,
  attachedDocumentCount,
  uploadMaxBytes,
  reminders,
  route,
  children,
}: TripChromeProps) {
  const isPrivate = trip.visibility === 'private';
  const pathname = usePathname();
  const isMapView = pathname === `/trips/${trip.id}/map`;
  const isArchived = trip.status === 'archived';
  const hasFilterBar = countries.length >= 2;
  const dateRange = formatTripDateSpan(trip.startDate, trip.endDate);

  // Cmd+K palette deep-links into segment rows via `#seg-<id>`. The hook
  // lives once at the chrome level so it survives sibling-tab navigation.
  useSegmentScrollFlash();

  return (
    <main
      className={cn(
        'mx-auto w-full px-6 pb-24 sm:px-8',
        isMapView ? 'max-w-6xl pt-6 sm:pt-10' : 'max-w-5xl pt-5 sm:pt-10',
      )}
    >
      {isMapView ? (
        <>
          <div className="atlas-rise mb-5" style={{ animationDelay: '40ms' }}>
            <Link
              href={`/trips/${trip.id}/itinerary`}
              // Same hit area as the tab header's "All trips" link, so the
              // two headers don't diverge: 44px on touch at every width,
              // released on pointer.
              className="text-foreground/70 hover:text-foreground inline-flex min-h-11 items-center gap-1.5 text-sm transition-colors [@media(hover:hover)]:min-h-0"
            >
              <span aria-hidden>←</span>
              <span>Back to trip</span>
            </Link>
          </div>

          <header
            className="atlas-rise mb-5 flex flex-wrap items-end justify-between gap-3"
            style={{ animationDelay: '100ms' }}
          >
            <h1 className="font-display text-foreground min-w-0 text-3xl leading-[1.04] tracking-tight break-words hyphens-auto sm:text-4xl">
              {trip.title}
            </h1>
            <p className="text-muted-foreground font-mono text-xs tracking-wider">{dateRange}</p>
          </header>
        </>
      ) : (
        <>
          {/* Back link with the trip's badges beside it, at every width —
           *  the badges stay on the ground colour, off the inverse banner
           *  where the status pills would lose their contrast, and the
           *  title below keeps the banner's full width at 360px. */}
          <div
            className="atlas-rise mb-4 flex items-center justify-between gap-3"
            style={{ animationDelay: '40ms' }}
          >
            <Link
              href="/trips"
              // Touch keeps the 44px target at every width — a tablet is
              // `sm:`+ but still finger-driven, and CLAUDE.md's rule 4 is
              // about the input, not the viewport. Only pointer drops it.
              className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1.5 text-sm font-medium transition-colors [@media(hover:hover)]:min-h-0"
            >
              <span aria-hidden>←</span>
              <span>All trips</span>
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              {isPrivate && <PrivateBadge />}
              <TripStatusBadge status={trip.status} />
            </div>
          </div>

          {/* The trip banner — the inverse "now / next" surface. Identity and
           *  actions on the left; from `md:` the route diagram sits on a
           *  perforated stub to the right. */}
          <header
            className="atlas-rise bg-inverse text-inverse-foreground mb-5 flex flex-col overflow-hidden rounded-[1.75rem] md:flex-row"
            style={{ animationDelay: '100ms' }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-5 px-5 py-6 sm:px-8 sm:py-8">
              <div>
                <p className="text-inverse-muted font-mono text-xs tracking-[0.06em] uppercase">
                  {dateRange}
                </p>
                {/* Title row — on phone the ⋯ overflow menu sits beside the
                 *  title (Upload / Edit / Archive / Delete); laptop puts the
                 *  actions in the inline row below. */}
                <div className="mt-2 flex items-start gap-3">
                  {/* `min-w-0` + `break-words`: a single long word (a place
                   *  name) would otherwise hold the title at its unbroken
                   *  width and scroll a 360px page sideways. `hyphens-auto`
                   *  lands the break on a syllable. */}
                  <h1 className="font-display min-w-0 flex-1 text-4xl leading-none tracking-tight break-words hyphens-auto sm:text-6xl">
                    {trip.title}
                  </h1>
                  {isOwner && (
                    <TripOverflowMenu
                      trip={trip}
                      isArchived={isArchived}
                      attachedDocumentCount={attachedDocumentCount}
                      uploadMaxBytes={uploadMaxBytes}
                    />
                  )}
                </div>
              </div>

              {/* Phone action row — Map is the only inline primary; the
               *  other maintenance actions live in the ⋯ menu above. Both
               *  take the 44px touch target (CLAUDE.md rule 4). */}
              <div className="flex flex-wrap items-center gap-3 sm:hidden">
                <Link
                  href={`/trips/${trip.id}/map`}
                  className={cn(
                    buttonVariants({ size: 'sm' }),
                    INVERSE_SOLID,
                    'inline-flex [@media(hover:none)]:h-11',
                  )}
                >
                  <MapIcon className="size-3.5" strokeWidth={2} />
                  <span>View map</span>
                </Link>
                {reminders && (
                  <TripReminderToggle
                    tripId={trip.id}
                    initialMuted={reminders.muted}
                    className={cn(INVERSE_OUTLINE, '[@media(hover:none)]:h-11')}
                    statusClassName="text-inverse-accent"
                  />
                )}
              </div>

              {/* Laptop action row. */}
              <div className="hidden flex-wrap items-center gap-2.5 sm:flex">
                {isOwner && (
                  <DocumentUploadDialog
                    tripId={trip.id}
                    maxBytes={uploadMaxBytes}
                    trigger={<Button size="sm">+ Upload</Button>}
                  />
                )}
                {/*
                  Render the Link directly with `buttonVariants` instead
                  of wrapping it in `<Button asChild>`. The Slot+Link
                  composition was shifting React 19's useId sequence
                  between server and client by ±2, which cascaded into a
                  hydration mismatch downstream in SegmentRow — Radix's
                  Dialog uses useId for the trigger/content linkage, and
                  the offset caused the Edit and Delete triggers to swap
                  IDs. The solid light pill marks "View map" as a
                  perspective switch rather than a same-context action.
                */}
                <Link
                  href={`/trips/${trip.id}/map`}
                  className={cn(buttonVariants({ size: 'sm' }), INVERSE_SOLID)}
                >
                  <MapIcon className="size-3.5" strokeWidth={2} />
                  <span>View map</span>
                </Link>
                {reminders && (
                  <TripReminderToggle
                    tripId={trip.id}
                    initialMuted={reminders.muted}
                    className={INVERSE_OUTLINE}
                    statusClassName="text-inverse-accent"
                  />
                )}
                {/* Trip-row maintenance is owner-only (ADR-0015). A household
                    member viewing a shared trip gets the read surfaces plus
                    "View map" — Edit/Archive/Delete don't render for them. */}
                {isOwner && (
                  <>
                    <TripFormDialog
                      mode="edit"
                      trip={trip}
                      trigger={
                        <Button variant="outline" size="sm" className={INVERSE_OUTLINE}>
                          Edit trip
                        </Button>
                      }
                    />
                    {isArchived ? (
                      <UnarchiveButton tripId={trip.id} className={INVERSE_OUTLINE} />
                    ) : (
                      <DeleteTripDialog
                        tripId={trip.id}
                        tripTitle={trip.title}
                        mode="archive"
                        trigger={
                          <Button variant="outline" size="sm" className={INVERSE_OUTLINE}>
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
                          className={cn(INVERSE_OUTLINE, 'text-inverse-accent')}
                        >
                          Delete forever
                        </Button>
                      }
                    />
                  </>
                )}
              </div>
            </div>

            {route.length > 0 && (
              <div className="border-inverse-line hidden min-w-0 border-l-2 border-dashed px-7 py-8 md:block md:w-[min(52%,34rem)]">
                <RouteDiagram stops={route} active={trip.status === 'active'} />
              </div>
            )}
          </header>

          <div
            className="atlas-rise mb-6 flex flex-col gap-4 sm:mb-8"
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
  uploadMaxBytes,
}: {
  trip: Trip;
  isArchived: boolean;
  attachedDocumentCount: number;
  uploadMaxBytes: number;
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
            className={cn('size-11 shrink-0 sm:hidden', INVERSE_OUTLINE)}
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

      <DocumentUploadDialog
        tripId={trip.id}
        maxBytes={uploadMaxBytes}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
      />
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

// Marks a trip the owner has opted out of household sharing. Only the
// owner ever reaches a private trip, so this never renders for anyone
// else.
function PrivateBadge() {
  return (
    <span className="border-border text-muted-foreground inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[11px] tracking-[0.06em] uppercase">
      <Lock className="size-2.5" strokeWidth={2} aria-hidden />
      Private
    </span>
  );
}
