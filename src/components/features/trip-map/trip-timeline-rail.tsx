'use client';

import {
  Bed,
  ChevronDown,
  MapPinOff,
  Plane,
  StickyNote,
  Star,
  Train,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';

import {
  splitCollapsedDays,
  summariseLocations,
} from '@/components/features/segments/day-temporal';
import { useItineraryCollapse } from '@/components/features/segments/use-itinerary-collapse';
import { parseDateString } from '@/components/ui/date-picker';
import type { Segment } from '@/lib/segments';
import { cn } from '@/lib/utils';

import type { RailDay, RailItem, RailItemIcon } from './timeline-model';

// Per-icon glyph for a rail row. Mirrors pin-marker's ICON_BY_KIND and
// adds `note` (rail-only). One row to add a new icon.
const ICON_BY_KIND: Readonly<Record<RailItemIcon, LucideIcon>> = {
  flight: Plane,
  hotel: Bed,
  activity: Star,
  transit: Train,
  food: UtensilsCrossed,
  note: StickyNote,
};

// Stable collapse key for the rail's one combined past group. Distinct
// from the itinerary's `"past"` key (CLAUDE issue #9 note) so the
// rail's collapse override is stored separately under the same per-trip
// localStorage blob — expanding the past on the map doesn't expand it
// on the itinerary tab and vice-versa.
const RAIL_PAST_GROUP_KEY = 'map-rail-past';

function parseDayKey(dateKey: string): Date {
  return parseDateString(dateKey) ?? new Date(0);
}

// "MON 5 OCT" — mono tracked-uppercase, matching the itinerary's day
// header language.
function formatDayLabel(d: Date): string {
  return d
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .toUpperCase();
}

function formatPastRangeLabel(first: Date, last: Date): string {
  const firstLabel = formatDayLabel(first);
  if (first.getTime() === last.getTime()) return firstLabel;
  return `${firstLabel} – ${formatDayLabel(last)}`;
}

export interface TripTimelineRailProps {
  tripId: string;
  days: RailDay[];
  /** True only for `trip.status === 'active'` — gates collapse + auto-scroll. */
  isActive: boolean;
  /** Currently focused day key (`?day=`), or null. */
  focusedDayKey: string | null;
  /** Currently selected segment id (a clicked row / map pin), or null. */
  selectedSegmentId: string | null;
  /** Focus a whole day — drives `?day=` + map fitBounds. */
  onFocusDay: (dayKey: string) => void;
  /** Hover a day (laptop) — ephemeral map highlight. null = leave. */
  onHoverDay: (dayKey: string | null) => void;
  /** Select a single mappable segment — pans the map + opens its tooltip. */
  onSelectSegment: (segmentId: string) => void;
}

// summariseLocations reads each segment's real `locationName` for the
// collapsed pill's "where" summary. The rail carries the lighter
// RailItem, but it now keeps the true locationName (NOT the display
// label, which is an IATA pair / "A → B" / note preview for several
// types) so the summary matches the itinerary tab's collapsed pill.
function railItemsAsLocationCarriers(items: RailItem[]): Pick<Segment, 'locationName'>[] {
  return items.map((i) => ({ locationName: i.locationName }));
}

// A single tappable segment row. Mappable rows pan the map on click;
// off-map rows (notes, ungeocoded) are inert but still visible, quieter,
// with their reason surfaced. 44px min touch target.
function SegmentRailRow({
  item,
  selected,
  onSelect,
}: {
  item: RailItem;
  selected: boolean;
  onSelect: (segmentId: string) => void;
}) {
  const Icon = ICON_BY_KIND[item.icon];
  const mappable = item.mapKind !== 'none';
  const continuation = item.continuation === true;

  const inner = (
    <>
      <span
        aria-hidden
        className={cn(
          'mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border',
          item.icon === 'food'
            ? 'border-accent/30 bg-accent/10 text-accent'
            : 'border-primary/25 bg-primary/8 text-primary',
          // A continuation is a quiet backdrop, not a fresh event — mute
          // its glyph regardless of type.
          continuation && 'border-foreground/15 bg-foreground/5 text-foreground/45',
          !mappable && 'border-foreground/15 bg-foreground/5 text-foreground/45',
        )}
      >
        <Icon className="size-3.5" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          {item.timeLabel && (
            <span className="text-foreground/45 shrink-0 font-mono text-[10px] tracking-[0.14em] tabular-nums">
              {item.timeLabel}
            </span>
          )}
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              mappable && !continuation ? 'text-foreground/90' : 'text-foreground/55',
            )}
          >
            {item.label}
          </span>
          {continuation && (
            <span className="border-foreground/20 text-foreground/50 shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.16em] uppercase">
              Staying
            </span>
          )}
        </span>
        {continuation && item.continuationSince && (
          <span className="text-foreground/40 mt-0.5 block text-xs">
            since {item.continuationSince}
          </span>
        )}
        {!mappable && !continuation && item.offMapReason && (
          <span className="text-foreground/40 mt-0.5 flex items-center gap-1 text-xs">
            <MapPinOff aria-hidden className="size-3 shrink-0" strokeWidth={1.5} />
            <span className="truncate">{item.offMapReason}</span>
          </span>
        )}
      </span>
    </>
  );

  if (!mappable) {
    return (
      <li
        className="flex min-h-11 items-start gap-3 rounded-lg px-2 py-1.5"
        // Off-map rows are intentionally inert — no pointer affordance.
      >
        {inner}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item.segmentId)}
        aria-pressed={selected}
        className={cn(
          'flex min-h-11 w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left transition-colors',
          selected ? 'bg-primary/10' : '[@media(hover:hover)]:hover:bg-foreground/5',
        )}
      >
        {inner}
      </button>
    </li>
  );
}

// One day block: header (Day NN · date, position styling, Today pill)
// over its segment rows. The whole header is a button that focuses the
// day (drives `?day=` + map fit). Hover on the block highlights the
// day's pins on the map.
function DayBlock({
  day,
  date,
  focused,
  selectedSegmentId,
  onFocusDay,
  onHoverDay,
  onSelectSegment,
  innerRef,
}: {
  day: RailDay;
  date: Date;
  focused: boolean;
  selectedSegmentId: string | null;
  onFocusDay: (dayKey: string) => void;
  onHoverDay: (dayKey: string | null) => void;
  onSelectSegment: (segmentId: string) => void;
  innerRef?: (el: HTMLDivElement | null) => void;
}) {
  const isToday = day.position === 'today';
  const isPast = day.position === 'past';

  return (
    <div
      ref={innerRef}
      className="scroll-mt-4"
      onMouseEnter={() => onHoverDay(day.key)}
      onMouseLeave={() => onHoverDay(null)}
    >
      <button
        type="button"
        onClick={() => onFocusDay(day.key)}
        aria-pressed={focused}
        className={cn(
          'group flex min-h-11 w-full items-baseline gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
          '[@media(hover:hover)]:hover:bg-foreground/4',
          focused && 'bg-primary/8',
        )}
      >
        <span
          className={cn(
            'font-mono text-[11px] tracking-[0.16em] uppercase transition-colors',
            isToday ? 'text-primary' : isPast ? 'text-foreground/45' : 'text-foreground/80',
          )}
        >
          Day {String(day.dayNumber).padStart(2, '0')}
        </span>
        <span
          className={cn(
            'font-mono text-[10px] tracking-[0.14em] whitespace-nowrap uppercase transition-colors',
            isPast ? 'text-foreground/35' : 'text-foreground/55',
          )}
        >
          {formatDayLabel(date)}
        </span>
        {isToday && (
          <span className="bg-primary/12 text-primary border-primary/25 rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.18em] uppercase">
            Today
          </span>
        )}
        <span aria-hidden className="bg-foreground/12 h-px flex-1 self-center" />
      </button>

      <ol className={cn('mt-1 mb-4 space-y-0.5', isPast && 'opacity-70')}>
        {day.items.map((item) => (
          <SegmentRailRow
            key={item.segmentId}
            item={item}
            selected={selectedSegmentId === item.segmentId}
            onSelect={onSelectSegment}
          />
        ))}
      </ol>
    </div>
  );
}

// Collapsed-past summary row — folds the leading run of fully-past days
// into a single tappable pill, mirroring the itinerary's collapsed-past
// pattern. Expanding reveals the days inline.
function CollapsedPastRow({ days, onExpand }: { days: RailDay[]; onExpand: () => void }) {
  const first = parseDayKey(days[0]!.dateKey);
  const last = parseDayKey(days[days.length - 1]!.dateKey);
  const rangeLabel = formatPastRangeLabel(first, last);
  const allItems = days.flatMap((d) => d.items);
  const locationSummary = summariseLocations(railItemsAsLocationCarriers(allItems) as Segment[]);

  return (
    <button
      type="button"
      onClick={onExpand}
      aria-expanded={false}
      aria-label={`Show ${days.length} past ${days.length === 1 ? 'day' : 'days'}`}
      className="group [@media(hover:hover)]:hover:bg-foreground/4 mb-3 flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors"
    >
      <ChevronDown
        aria-hidden
        strokeWidth={1.75}
        className="text-foreground/35 group-hover:text-foreground/70 size-3.5 shrink-0 -rotate-90 transition-[transform,color]"
      />
      <span className="text-foreground/65 group-hover:text-foreground/85 min-w-0 truncate font-mono text-[10px] tracking-[0.16em] uppercase">
        {rangeLabel}
      </span>
      {locationSummary && (
        <span className="text-foreground/55 hidden min-w-0 truncate text-xs sm:inline">
          {locationSummary}
        </span>
      )}
      <span aria-hidden className="bg-foreground/12 h-px flex-1" />
    </button>
  );
}

// Expanded-past header — collapses the run back up. The days render
// below it as normal DayBlocks (past styling).
function ExpandedPastHeader({ onCollapse }: { onCollapse: () => void }) {
  return (
    <button
      type="button"
      onClick={onCollapse}
      aria-expanded={true}
      aria-label="Collapse past days"
      className="group [@media(hover:hover)]:hover:bg-foreground/4 mb-2 flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors"
    >
      <ChevronDown
        aria-hidden
        strokeWidth={1.75}
        className="text-foreground/35 group-hover:text-foreground/70 size-3.5 shrink-0 transition-colors"
      />
      <span className="text-foreground/65 group-hover:text-foreground/85 font-mono text-[10px] tracking-[0.2em] uppercase">
        Earlier
      </span>
      <span aria-hidden className="bg-foreground/12 h-px flex-1" />
    </button>
  );
}

/**
 * The day-grouped timeline rail content. Shared by the laptop sidebar
 * and the mobile vaul sheet — the surrounding container differs, the
 * list does not.
 *
 * Reuses the itinerary's classification (`day-temporal.ts`) and
 * collapse-persistence (`use-itinerary-collapse.ts`):
 *   - collapsed-past runs ONLY for an active trip (issue #8 parity);
 *   - auto-scroll-to-today fires once on mount for an active trip,
 *     honouring `prefers-reduced-motion`.
 */
export function TripTimelineRail({
  tripId,
  days,
  isActive,
  focusedDayKey,
  selectedSegmentId,
  onFocusDay,
  onHoverDay,
  onSelectSegment,
}: TripTimelineRailProps) {
  // Per-trip collapse persistence. Shares the itinerary's localStorage
  // blob (keyed by trip id) but under a distinct group key
  // (RAIL_PAST_GROUP_KEY) so the rail's collapse state is independent of
  // the itinerary tab's.
  const collapse = useItineraryCollapse(tripId);
  const todayRef = React.useRef<HTMLDivElement | null>(null);
  const hasScrolledRef = React.useRef(false);

  // Split the leading run of past days (which collapse) from the rest.
  // Position-driven — splitCollapsedDays reads only each day's server-set
  // `position`, so the client split agrees with the server classification
  // by construction. Ongoing multi-day stays are surfaced as continuation
  // rows (baked into the visible days server-side), not by keeping their
  // check-in day expanded.
  const { collapsed: pastDays, visible: restDays } = React.useMemo(
    () => splitCollapsedDays(days),
    [days],
  );

  const storedExpanded = collapse.isExpanded(RAIL_PAST_GROUP_KEY, false);

  // Auto-scroll to today once on mount for an active trip. rAF lets the
  // rail finish layout; reduced-motion downgrades to an instant jump.
  React.useEffect(() => {
    if (!isActive) return;
    if (hasScrolledRef.current) return;
    const el = todayRef.current;
    if (!el) return;
    hasScrolledRef.current = true;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [isActive]);

  // Inactive trip — every day rendered plainly, no collapse, no
  // auto-scroll (issue #8 parity: planned has no past, completed would
  // vanish behind a pill).
  if (!isActive) {
    return (
      <div className="px-1">
        {days.map((day) => (
          <DayBlock
            key={day.key}
            day={day}
            date={parseDayKey(day.dateKey)}
            focused={focusedDayKey === day.key}
            selectedSegmentId={selectedSegmentId}
            onFocusDay={onFocusDay}
            onHoverDay={onHoverDay}
            onSelectSegment={onSelectSegment}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="px-1">
      {pastDays.length > 0 &&
        (storedExpanded ? (
          <div className="mb-2">
            <ExpandedPastHeader onCollapse={() => collapse.toggle(RAIL_PAST_GROUP_KEY, false)} />
            {pastDays.map((day) => (
              <DayBlock
                key={day.key}
                day={day}
                date={parseDayKey(day.dateKey)}
                focused={focusedDayKey === day.key}
                selectedSegmentId={selectedSegmentId}
                onFocusDay={onFocusDay}
                onHoverDay={onHoverDay}
                onSelectSegment={onSelectSegment}
              />
            ))}
          </div>
        ) : (
          <CollapsedPastRow
            days={pastDays}
            onExpand={() => collapse.toggle(RAIL_PAST_GROUP_KEY, false)}
          />
        ))}

      {restDays.map((day) => (
        <DayBlock
          key={day.key}
          day={day}
          date={parseDayKey(day.dateKey)}
          focused={focusedDayKey === day.key}
          selectedSegmentId={selectedSegmentId}
          onFocusDay={onFocusDay}
          onHoverDay={onHoverDay}
          onSelectSegment={onSelectSegment}
          innerRef={
            day.position === 'today'
              ? (el) => {
                  todayRef.current = el;
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}
