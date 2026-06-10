import { BedDouble, Bus, Car, MapPin, Plane, Ship, Sparkles, TrainFront } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { Segment, SegmentType } from '@/lib/segments';
import { transitDataSchema } from '@/lib/segments';
import { cn } from '@/lib/utils';

import { continuationCheckOutTime, continuationName, continuationPill } from './continuations';

// Per-type glyph for the quiet continuation row. Mirrors the icons each
// SegmentCard variant picks so the continuation reads as the same place.
// Transit resolves its mode glyph separately (it has five), so the map's
// transit entry is only the fallback. Food / note never reach here (they
// can't span days — see `continuesThroughDay`); `MapPin` covers them
// defensively.
const TYPE_ICON: Record<SegmentType, LucideIcon> = {
  flight: Plane,
  hotel: BedDouble,
  activity: Sparkles,
  transit: TrainFront,
  food: MapPin,
  note: MapPin,
};

const TRANSIT_MODE_ICON: Record<string, LucideIcon> = {
  train: TrainFront,
  bus: Bus,
  ferry: Ship,
  car: Car,
};

// Resolves the glyph for a segment. Returns the element (not the
// component) so the caller doesn't assign a capitalised component into a
// render-time local — which `react-hooks/static-components` forbids.
function renderIcon(segment: Segment) {
  let Icon: LucideIcon = TYPE_ICON[segment.type];
  if (segment.type === 'transit') {
    const parsed = transitDataSchema.safeParse(segment.data);
    if (parsed.success) Icon = TRANSIT_MODE_ICON[parsed.data.mode] ?? TYPE_ICON.transit;
  }
  return <Icon aria-hidden strokeWidth={1.5} className="size-3.5 shrink-0" />;
}

// "28 May" — the check-in date a continuing stay began on. Read in UTC
// (floating local time, ADR-0014) so it names the same calendar day as
// the segment's day-group header and the trip-map rail's twin label,
// instead of the viewer-local day of the raw instant.
const SINCE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
function formatSinceDate(d: Date): string {
  return SINCE_FMT.format(d);
}

// A continuation: a multi-day segment (a hotel stay, almost always) that
// checked in on an earlier, now-collapsed day and is still running on
// this one. It is NOT a full SegmentCard — it's a quiet backdrop row that
// keeps the stay visible where you are without reopening unrelated past
// days. Sage-toned (`--color-accent`) so it reads as secondary to the
// day's own cards, which it sits above.
//
// Tapping it deep-links to the real card via `#seg-<id>` — the same hash
// target SegmentRow exposes. The card lives in the collapsed past group;
// the link both force-expands that group (ItineraryDayList watches the
// hash) and triggers the scroll-flash, so the primary record is one tap
// away without duplicating it here.
//
// `onActivate` fires alongside the native navigation so the row works on
// every click, not just the first. A stay spans several days and shows
// the *same* `#seg-<id>` link on each, so re-clicking lands on the hash
// that's already set — the browser fires no `hashchange`, and the bare
// anchor would be inert. The parent's `onActivate` re-arms the
// force-expand and nudges the scroll-flash regardless (ItineraryDayList).
//
// Touch target: the link is `min-h-[44px]`, satisfying the responsive
// rule for an interactive row on touch devices.
function ContinuationRow({
  segment,
  checkOutTime,
  onActivate,
}: {
  segment: Segment;
  // The stay's check-out time ("11:00"), present ONLY on the row rendered
  // for the stay's final day (see `continuationCheckOutTime`). Null on
  // every earlier day, so check-out reads only where you actually leave.
  checkOutTime: string | null;
  onActivate?: () => void;
}) {
  const name = continuationName(segment);
  const since = segment.startsAt ? formatSinceDate(segment.startsAt) : null;
  // "Staying" for a hotel, "Ongoing" for every other spanning type.
  const pill = continuationPill(segment.type);

  // One clean spoken phrase for the whole row — the visible glyph, tag,
  // "since" date, and check-out time are all `aria-hidden` so a screen
  // reader hears this once instead of the disjoint visual fragments.
  const word = pill.toLowerCase();
  const baseLabel = since ? `${name} — ${word} since ${since}` : `${name} — ${word}`;
  const label = checkOutTime ? `${baseLabel}, checking out at ${checkOutTime}` : baseLabel;

  return (
    <a
      href={`#seg-${segment.id}`}
      aria-label={label}
      onClick={onActivate}
      className={cn(
        'group flex min-h-[44px] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
        'text-accent/90 [@media(hover:hover)]:hover:text-accent transition-colors',
        '[@media(hover:hover)]:hover:bg-accent/5',
      )}
    >
      {renderIcon(segment)}
      {/* Headline — truncates rather than wrapping so the row stays one
       *  line and reads as a quiet marker, not a card. */}
      <span aria-hidden className="min-w-0 truncate text-sm">
        {name}
      </span>
      <span
        aria-hidden
        className="border-accent/45 text-accent shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.18em] uppercase"
      >
        {pill}
      </span>
      {since && (
        <span
          aria-hidden
          className="text-accent shrink-0 font-mono text-[10px] tracking-[0.12em] whitespace-nowrap"
        >
          since {since}
        </span>
      )}
      {/* Final day of the stay — surface the check-out time so the last
       *  "Staying" row reads as the checkout, without a card of its own.
       *  A filled accent chip (vs the bordered "Staying" pill) makes it the
       *  prominent element of an otherwise quiet backdrop row. */}
      {checkOutTime && (
        <span
          aria-hidden
          className="bg-accent text-accent-foreground shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap"
        >
          Check Out {checkOutTime}
        </span>
      )}
    </a>
  );
}

// The continuation block at the top of a day's content — every ongoing
// stay that continues through this day, above the day's own segments.
// Returns null when there are none so DayGroup can render it
// unconditionally.
export function DayContinuations({
  continuations,
  dayKey,
  onActivate,
}: {
  continuations: Segment[];
  // The `YYYY-MM-DD` key of the day these rows render under — used to
  // surface the check-out time on the stay's final day only.
  dayKey: string;
  // Forwarded to every row so a tap re-arms the past-group expand and
  // re-fires the scroll-flash even when the hash is unchanged.
  onActivate?: () => void;
}) {
  if (continuations.length === 0) return null;
  return (
    <div className="mb-3 space-y-0.5 sm:mb-4">
      {continuations.map((seg) => (
        <ContinuationRow
          key={seg.id}
          segment={seg}
          checkOutTime={continuationCheckOutTime(seg, dayKey)}
          onActivate={onActivate}
        />
      ))}
    </div>
  );
}
