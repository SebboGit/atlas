'use client';

import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import { useMounted } from '@/components/client-only';
import { parseDateString } from '@/components/ui/date-picker';
import type { LinkedDocument } from '@/lib/documents';
import type { Segment } from '@/lib/segments';
import { cn } from '@/lib/utils';

import { continuationsByDayKey } from './continuations';
import { DayGroup } from './day-group';
import {
  classifyDay,
  daysContainSegment,
  splitCollapsedDays,
  type DayPosition,
} from './day-temporal';
import { useItineraryCollapse } from './use-itinerary-collapse';

const SEG_HASH_PREFIX = '#seg-';

// Stable collapse key for the one combined past group. There is exactly
// one collapsible region per itinerary now (all past days fold into it),
// so a fixed key is all `useItineraryCollapse` needs to persist against.
const PAST_GROUP_KEY = 'past';

// Parses an `ItineraryDay.dateKey` (`YYYY-MM-DD`, always produced by
// `dayKey`) into a local-midnight Date. The token is server-generated
// and structurally valid, so a failed parse means a bug upstream — fall
// back to the epoch rather than crashing render. `parseDateString`
// builds the Date in local time, so the rendered calendar day never
// shifts by the client's timezone.
function parseDayKey(dateKey: string): Date {
  return parseDateString(dateKey) ?? new Date(0);
}

// Reads `#seg-<id>` from the current location hash, returning the bare
// segment id (or null when no segment deep-link is present). Guarded
// for SSR — the server render has no `window`.
function readSegmentHashId(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  return hash.startsWith(SEG_HASH_PREFIX) ? hash.slice(SEG_HASH_PREFIX.length) : null;
}

// `useSyncExternalStore` plumbing for the location hash. Reading the
// hash this way (rather than seeding state once on mount) keeps the
// deep-link force-expand in sync when the user navigates to a `#seg-…`
// hash while already on the itinerary page — and it does so without a
// setState-in-effect, which the React lint rules forbid.
function subscribeToHash(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function getHashSnapshot(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

// The server render has no location hash — match that on the first
// client paint so hydration agrees, then `useSyncExternalStore` swaps
// in the real hash.
function getHashServerSnapshot(): string {
  return '';
}

// Subscribes to the current location hash. Re-renders on every
// `hashchange`, so any derived deep-link state stays current.
function useLocationHash(): string {
  return React.useSyncExternalStore(subscribeToHash, getHashSnapshot, getHashServerSnapshot);
}

// Day classification runs in the client's timezone only after hydration
// (via the shared useMounted gate) — getServerSnapshot keeps SSR and the
// first client paint agreeing, then it flips true on mount and the
// timezone-aware split resolves, with no setState-in-effect.

// Plain, serialisable shape the server page hands down. The page
// classifies days server-side (it already knows `today`), so the
// client only carries the resolved position — no Date maths re-run
// here beyond what scroll/format needs.
export interface ItineraryDay {
  // Stable per-day key — `YYYY-MM-DD`, matches `groupSegmentsByDay`'s
  // bucketing.
  key: string;
  // Timezone-stable `YYYY-MM-DD` day token. Parsed on the client as a
  // local calendar date (via `parseDateString`) for label formatting —
  // a UTC ISO instant would shift the rendered day across timezones.
  dateKey: string;
  dayNumber: number;
  position: DayPosition;
  segments: Segment[];
}

interface ItineraryDayListProps {
  tripId: string;
  days: ItineraryDay[];
  // True only for a trip whose status is `active`. The collapsed-past
  // behaviour and the auto-scroll-to-today fire exclusively for active
  // trips — a `completed` trip would otherwise hide its whole itinerary
  // behind one pill, and a `planned` trip has no past days. Inactive
  // trips render every day fully expanded, no collapse, no auto-scroll.
  isActive: boolean;
  linkedDocumentsBySegment?: Map<string, LinkedDocument[]>;
  /** Trip-wide segmentId → cached coordinates map. Drives the Plus Code badge. */
  coordsBySegmentId?: Map<string, { lat: number; lng: number }>;
}

function formatRangeLabel(d: Date): string {
  return d
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .toUpperCase();
}

// Compact label for a span of past days. A single past day shows just
// its date; a multi-day span shows "FIRST – LAST". Both ends use the
// same mono tracked-uppercase treatment as a DayGroup header.
function formatPastRangeLabel(first: Date, last: Date): string {
  const firstLabel = formatRangeLabel(first);
  if (first.getTime() === last.getTime()) return firstLabel;
  return `${firstLabel} – ${formatRangeLabel(last)}`;
}

// Collapsed past span — a single eyebrow-ruled row in the field-notebook
// language: a mono tracked-uppercase date range covering every past day,
// a quiet location summary drawn from all of them, the total segment
// count, and a chevron. The whole row is the toggle; it meets the 44px
// touch target via min-height and generous vertical padding.
//
// Density follows the viewport (CLAUDE.md responsive rule). At 360px
// the row carries only what fits without horizontal scroll: chevron,
// date range, stop count. The location summary and the "N days" detail
// are secondary — the date range already implies the span — so both
// only appear from `sm:` up.
function CollapsedPastRow({
  rangeLabel,
  dayCount,
  onExpand,
}: {
  rangeLabel: string;
  dayCount: number;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-expanded={false}
      aria-label={`Show ${dayCount} past ${dayCount === 1 ? 'day' : 'days'}`}
      className={cn(
        'group flex min-h-[44px] w-full items-center gap-3 py-2 text-left',
        'transition-colors',
      )}
    >
      <ChevronDown
        aria-hidden
        strokeWidth={2.25}
        className="text-primary size-4 shrink-0 -rotate-90 transition-transform duration-150"
      />
      {/* `min-w-0` + `truncate` let the range ellipsise rather than
       *  force a horizontal scroll if the viewport is narrower than the
       *  full label — the count below stays pinned and readable. */}
      <span className="text-foreground/85 min-w-0 truncate font-mono text-xs tracking-[0.2em] whitespace-nowrap uppercase">
        {rangeLabel}
      </span>
      <span aria-hidden className="bg-foreground/15 h-px flex-1" />
    </button>
  );
}

// Expanded past span — a quiet eyebrow header carrying a collapse
// chevron, followed by every past day rendered as a normal DayGroup.
// The chevron folds the whole span back into the collapsed row; the
// individual DayGroups inside carry no per-day collapse affordance.
function ExpandedPastGroup({
  days,
  tripId,
  linkedDocumentsBySegment,
  coordsBySegmentId,
  continuations,
  onContinuationActivate,
  onCollapse,
}: {
  days: ItineraryDay[];
  tripId: string;
  linkedDocumentsBySegment?: Map<string, LinkedDocument[]>;
  coordsBySegmentId?: Map<string, { lat: number; lng: number }>;
  continuations: Map<string, Segment[]>;
  onContinuationActivate?: () => void;
  onCollapse: () => void;
}) {
  return (
    <div>
      {/* The whole header row is the collapse toggle — chevron, the
       *  "Earlier" eyebrow, and the hairline all fold the span back up,
       *  mirroring the collapsed row where the whole row expands. */}
      <header className="mb-4 sm:mb-5">
        <button
          type="button"
          onClick={onCollapse}
          aria-expanded={true}
          aria-label="Collapse past days"
          className="group flex min-h-[44px] w-full items-center gap-3 py-2 text-left transition-colors"
        >
          <ChevronDown aria-hidden strokeWidth={2.25} className="text-primary size-4 shrink-0" />
          <span className="text-foreground/85 font-mono text-xs tracking-[0.28em] uppercase">
            Earlier
          </span>
          <span
            aria-hidden
            className="bg-foreground/15 group-hover:bg-foreground/25 h-px flex-1 transition-colors"
          />
        </button>
      </header>
      {days.map((day) => (
        <DayGroup
          key={day.key}
          dayNumber={day.dayNumber}
          date={parseDayKey(day.dateKey)}
          segments={day.segments}
          tripId={tripId}
          linkedDocumentsBySegment={linkedDocumentsBySegment}
          coordsBySegmentId={coordsBySegmentId}
          position="past"
          continuations={continuations.get(day.key)}
          dayKey={day.key}
          onContinuationActivate={onContinuationActivate}
        />
      ))}
    </div>
  );
}

// The single combined past group — collapsed into one row by default,
// expanding inline to reveal every past day. Replaces the former
// per-day pills: the user folds/unfolds the entire past span at once.
function PastGroup({
  days,
  tripId,
  linkedDocumentsBySegment,
  coordsBySegmentId,
  continuations,
  onContinuationActivate,
  isExpanded,
  onToggle,
}: {
  days: ItineraryDay[];
  tripId: string;
  linkedDocumentsBySegment?: Map<string, LinkedDocument[]>;
  coordsBySegmentId?: Map<string, { lat: number; lng: number }>;
  continuations: Map<string, Segment[]>;
  onContinuationActivate?: () => void;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const rangeLabel = React.useMemo(() => {
    const first = parseDayKey(days[0]!.dateKey);
    const last = parseDayKey(days[days.length - 1]!.dateKey);
    return formatPastRangeLabel(first, last);
  }, [days]);

  if (!isExpanded) {
    return (
      <section className="mb-8 sm:mb-10">
        <CollapsedPastRow rangeLabel={rangeLabel} dayCount={days.length} onExpand={onToggle} />
      </section>
    );
  }

  return (
    <section className="mb-8 sm:mb-10">
      <ExpandedPastGroup
        days={days}
        tripId={tripId}
        linkedDocumentsBySegment={linkedDocumentsBySegment}
        coordsBySegmentId={coordsBySegmentId}
        continuations={continuations}
        onContinuationActivate={onContinuationActivate}
        onCollapse={onToggle}
      />
    </section>
  );
}

// Client wrapper for the day-grouped itinerary. Owns the collapse
// interaction for the single combined past group, the localStorage-
// backed override state, and the one-time auto-scroll to today. Data
// fetching stays on the server page — this only receives already-
// shaped, serialisable day data.
//
// For an inactive trip (`isActive` false) this is a thin pass-through:
// every day renders as a full DayGroup with no collapse and no
// auto-scroll — the pre-collapse behaviour.
//
// Reusability note for issue #9: the classification (`day-temporal.ts`)
// and the persistence hook (`use-itinerary-collapse.ts`) are the
// reusable pieces — the timeline rail can lean on both. This component
// itself is itinerary-specific layout and is not meant to be shared.
export function ItineraryDayList({
  tripId,
  days,
  isActive,
  linkedDocumentsBySegment,
  coordsBySegmentId,
}: ItineraryDayListProps) {
  const { isExpanded, toggle } = useItineraryCollapse(tripId);
  const todayRef = React.useRef<HTMLDivElement | null>(null);
  const hasScrolledRef = React.useRef(false);

  // The past/today/future split happens in the VIEWER's timezone, resolved
  // on mount — the server's clock isn't the user's, so "today" must be the
  // client's. `null` until mounted: the first (SSR-matching) render shows
  // every day expanded; the collapse + today anchor apply once it lands.
  // (Inactive trips skip this entirely — they have no "today" to place.)
  // Memoised on `mounted` so the date identity is stable across re-renders
  // (the split useMemo and the scroll effect depend on it).
  const mounted = useMounted();
  const clientToday = React.useMemo(() => (mounted ? new Date() : null), [mounted]);

  // Ongoing-stay continuations, keyed by day. Clock-free — they derive
  // purely from segment spans against the day tokens (see
  // `continuationsByDayKey`), so they render identically on the server
  // paint and in every viewer timezone, on every day a stay spans.
  const continuations = React.useMemo(() => continuationsByDayKey(days), [days]);

  // Split the days into the leading collapsible run and everything that
  // must stay expanded. `collapsed` is the ENTIRE leading run of past
  // days; `visible` is today + every future day. Unlike the
  // continuations above, this IS clock-driven — "past" only exists
  // relative to the viewer's today.
  const { collapsed: pastDays, visible: restDays } = React.useMemo(() => {
    if (!clientToday) {
      // Pre-mount, SSR-stable: nothing collapsed, every day visible and
      // un-highlighted (position neutralised), so the first paint never
      // shows a server-timezone guess.
      return {
        collapsed: [] as ItineraryDay[],
        visible: days.map((d) => ({ ...d, position: 'future' as DayPosition })),
      };
    }
    // Re-derive each day's position from its stable date token against
    // the client's "today", then split on that.
    const classified = days.map((d) => ({
      ...d,
      position: classifyDay(parseDayKey(d.dateKey), clientToday),
    }));
    return splitCollapsedDays(classified);
  }, [days, clientToday]);

  // The live location hash. Subscribed via `useSyncExternalStore`, so a
  // `#seg-…` deep link that arrives *after* mount (the Cmd+K palette can
  // navigate without a full reload) re-derives the force-expand below —
  // not just the hash present on the initial render.
  const locationHash = useLocationHash();

  // The hash value the user last dismissed by clicking the past group's
  // collapse chevron. The force-expand is an initial nudge, not a
  // permanent pin: once released for a given hash, that exact hash no
  // longer forces the group open. A *new* `#seg-…` hash differs from
  // the released one, so a later deep link re-applies the force-expand.
  const [releasedHash, setReleasedHash] = React.useState<string | null>(null);

  // Whether a `#seg-<id>` deep link should force the combined past group
  // open: the segment lives in a *collapsed* past day (so its `#seg-`
  // scroll target only exists in the DOM once the past group expands),
  // the trip is active, and the user has not already dismissed this
  // exact hash. A deep link into a still-visible past day — one kept
  // expanded by an ongoing segment — needs no expansion, so it is tested
  // against `pastDays`, the collapsed subset, not every past day.
  const deepLinkExpandsPast = React.useMemo(() => {
    if (!isActive) return false;
    if (locationHash === releasedHash) return false;
    const segmentId = readSegmentHashId();
    return segmentId ? daysContainSegment(pastDays, segmentId) : false;
  }, [isActive, locationHash, releasedHash, pastDays]);

  // Dismisses the deep-link force-expand for the current hash so the
  // collapse chevron actually folds the group instead of being a no-op.
  const releaseDeepLink = React.useCallback(() => {
    setReleasedHash(getHashSnapshot());
  }, []);

  // Tapping a continuation row must expand the past group
  // and flash its card on *every* tap. A multi-day stay shows the same
  // `#seg-<id>` link on each day it spans, so a second tap lands on the
  // hash that's already set: the browser fires no `hashchange`, the
  // force-expand below never re-derives, and use-segment-scroll-flash
  // never re-runs — the bare anchor is a one-shot. Re-arm both paths
  // here. Clearing `releasedHash` lets a tap re-open the group even after
  // the user previously collapsed it (which released that exact hash),
  // and the custom event is the same same-hash nudge the Cmd+K palette
  // uses — deferred a frame so the anchor's own hash update lands first.
  const handleContinuationActivate = React.useCallback(() => {
    setReleasedHash(null);
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('atlas:seg-target-changed'));
      });
    }
  }, []);

  // Auto-scroll to today's group once, on open. Guarded so it fires a
  // single time per mount (not on every collapse toggle), and skipped
  // when a `#seg-` deep link is present so the search-palette scroll
  // (use-segment-scroll-flash) keeps priority over the today anchor.
  // Only runs for an active trip — inactive trips render plainly.
  React.useEffect(() => {
    if (!isActive) return;
    if (hasScrolledRef.current) return;
    if (readSegmentHashId() !== null) {
      hasScrolledRef.current = true;
      return;
    }
    const el = todayRef.current;
    if (!el) return;
    hasScrolledRef.current = true;
    // Honour the OS reduced-motion preference — this is the only
    // auto-scroll in the app; use-segment-scroll-flash and atlas-rise
    // both already respect it, so smooth scroll here would be the lone
    // unguarded motion.
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // rAF lets the day rows finish their entrance layout before we
    // measure the scroll target.
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
    // `clientToday` is a dep so the scroll fires once the today anchor
    // exists — it only resolves after the timezone-aware classification.
  }, [isActive, clientToday]);

  // Inactive trip — render every day plainly, fully expanded, with no
  // collapse affordance and no auto-scroll. This is the pre-#14
  // behaviour: a `planned` trip has no past to fold, and a `completed`
  // one would vanish behind a single pill if it did.
  if (!isActive) {
    return (
      <div>
        {days.map((day, i) => (
          <div key={day.key} className="atlas-rise" style={{ animationDelay: `${300 + i * 60}ms` }}>
            <DayGroup
              dayNumber={day.dayNumber}
              date={parseDayKey(day.dateKey)}
              segments={day.segments}
              tripId={tripId}
              linkedDocumentsBySegment={linkedDocumentsBySegment}
              coordsBySegmentId={coordsBySegmentId}
              position={day.position}
              continuations={continuations.get(day.key)}
              dayKey={day.key}
              onContinuationActivate={handleContinuationActivate}
            />
          </div>
        ))}
      </div>
    );
  }

  // A deep link into a past segment forces the past group open
  // regardless of its default or any stored collapse override, so the
  // `#seg-` scroll target is in the DOM for use-segment-scroll-flash.
  // Past defaults to collapsed; `storedPastExpanded` reads any stored
  // override on its own, so the collapse handler below can tell a
  // genuine "user expanded this" from a deep-link-only force-expand.
  const storedPastExpanded = isExpanded(PAST_GROUP_KEY, false);
  const pastExpanded = deepLinkExpandsPast || storedPastExpanded;

  // Stagger index runs across the past group (when present) and every
  // rest day, so the entrance animation cascades over the whole list.
  let staggerIndex = 0;

  return (
    <div>
      {pastDays.length > 0 && (
        <div
          // One-shot entrance stagger. The CSS animation plays once on
          // mount and never replays (collapse toggles don't remount the
          // element), so leaving the class on is harmless.
          className="atlas-rise"
          style={{ animationDelay: `${300 + staggerIndex++ * 60}ms` }}
        >
          <PastGroup
            days={pastDays}
            tripId={tripId}
            linkedDocumentsBySegment={linkedDocumentsBySegment}
            coordsBySegmentId={coordsBySegmentId}
            continuations={continuations}
            onContinuationActivate={handleContinuationActivate}
            isExpanded={pastExpanded}
            onToggle={() => {
              // Collapsing the past group. A deep-link force-expand and
              // a stored "user expanded this" override can both be in
              // effect at once, so clearing only the force flag would
              // leave the stored override resolving to expanded — the
              // collapse click would be a no-op. Release the force flag
              // *and*, if the stored override is still expanded, flip it
              // collapsed so the click genuinely lands collapsed.
              if (deepLinkExpandsPast) {
                releaseDeepLink();
                if (storedPastExpanded) {
                  toggle(PAST_GROUP_KEY, false);
                }
                return;
              }
              toggle(PAST_GROUP_KEY, false);
            }}
          />
        </div>
      )}

      {restDays.map((day) => (
        <div
          key={day.key}
          className="atlas-rise"
          style={{ animationDelay: `${300 + staggerIndex++ * 60}ms` }}
        >
          <div
            // Only today's group gets the scroll anchor ref; scroll-mt
            // clears the sticky topbar so the auto-scroll doesn't tuck
            // it underneath.
            {...(day.position === 'today'
              ? {
                  ref: (el: HTMLDivElement | null) => {
                    todayRef.current = el;
                  },
                  className: 'scroll-mt-24',
                }
              : {})}
          >
            <DayGroup
              dayNumber={day.dayNumber}
              date={parseDayKey(day.dateKey)}
              segments={day.segments}
              tripId={tripId}
              linkedDocumentsBySegment={linkedDocumentsBySegment}
              coordsBySegmentId={coordsBySegmentId}
              position={day.position}
              continuations={continuations.get(day.key)}
              dayKey={day.key}
              onContinuationActivate={handleContinuationActivate}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
