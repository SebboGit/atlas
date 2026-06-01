import { BedDouble, Bus, Car, MapPin, Plane, Ship, Sparkles, TrainFront } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { Segment, SegmentType } from '@/lib/segments';
import { transitDataSchema } from '@/lib/segments';
import { cn } from '@/lib/utils';

import { continuationName } from './continuations';

// Per-type glyph for the quiet continuation row. Mirrors the icons each
// SegmentCard variant picks so the continuation reads as the same place.
// Transit resolves its mode glyph separately (it has five), so the map's
// transit entry is only the fallback. Food / note never reach here (they
// can't span days — see `isOngoing`); `MapPin` covers them defensively.
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

// "28 May" — the check-in date a continuing stay began on. Local
// formatting matches the day-group date labels.
function formatSinceDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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
// Touch target: the link is `min-h-[44px]`, satisfying the responsive
// rule for an interactive row on touch devices.
function ContinuationRow({ segment }: { segment: Segment }) {
  const name = continuationName(segment);
  const since = segment.startsAt ? formatSinceDate(segment.startsAt) : null;

  // One clean spoken phrase for the whole row — the visible glyph, tag,
  // and "since" date are all `aria-hidden` so a screen reader hears this
  // once instead of the disjoint visual fragments.
  const label = since ? `${name} — staying since ${since}` : `${name} — staying`;

  return (
    <a
      href={`#seg-${segment.id}`}
      aria-label={label}
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
        Staying
      </span>
      {since && (
        <span
          aria-hidden
          className="text-accent shrink-0 font-mono text-[10px] tracking-[0.12em] whitespace-nowrap"
        >
          since {since}
        </span>
      )}
    </a>
  );
}

// The continuation block at the top of a day's content — every ongoing
// stay that continues through this day, above the day's own segments.
// Returns null when there are none so DayGroup can render it
// unconditionally.
export function DayContinuations({ continuations }: { continuations: Segment[] }) {
  if (continuations.length === 0) return null;
  return (
    <div className="mb-3 space-y-0.5 sm:mb-4">
      {continuations.map((seg) => (
        <ContinuationRow key={seg.id} segment={seg} />
      ))}
    </div>
  );
}
