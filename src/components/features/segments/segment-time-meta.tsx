import { formatTime } from '@/lib/format';

// Floating-UTC segment times (ADR-0014) render in UTC so the wall-clock
// the user typed shows back unchanged for every viewer — deterministic
// server-side, with no client mount-gate. A date-only pick lands on UTC
// midnight and carries no meaningful clock time, so we read "is this
// midnight?" in UTC and suppress the time line for it.
const DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});

function hasTimeComponent(d: Date): boolean {
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
}

interface SegmentTimeMetaProps {
  startsAt: Date | null;
  endsAt: Date | null;
  // On the flat Activity / Food tabs there is no day-group header, so the
  // card leads with its own date. The itinerary leaves this off and lets
  // the day header carry the date (the card stays time-only).
  showDate?: boolean;
}

// The stacked time meta shared by the activity and food cards. Renders
// nothing for an undated segment, and nothing for a date-only segment
// when the date isn't being shown (the day header already has it). When
// shown, a date eyebrow leads, the wall-clock time follows, and a timed
// end is appended.
export function SegmentTimeMeta({ startsAt, endsAt, showDate = false }: SegmentTimeMetaProps) {
  if (!startsAt) {
    // On the flat tabs an undated card is distinguished from a dated one
    // only by the absence of a date line — fine visually (in a list of
    // dated peers), but a screen reader can't perceive an absence. Give it
    // a positive, terse token so the state is announced. Off the flat tabs
    // (the itinerary), undated segments are filtered out, so render nothing.
    return showDate ? <span className="sr-only">Undated</span> : null;
  }
  const timed = hasTimeComponent(startsAt);
  if (!showDate && !timed) return null;

  // Rendered on a ticket stub: colours come from the inherited tone ink,
  // varied only by opacity.
  return (
    // One line in the phone strip, stacked in the laptop stub column.
    <div className="flex flex-wrap items-baseline gap-x-2 leading-tight sm:block">
      {showDate && (
        <div
          className={
            timed
              ? 'font-mono text-[10px] tracking-[0.08em] uppercase opacity-75 sm:mb-1'
              : 'font-mono text-[11px] font-medium tracking-[0.08em] uppercase'
          }
        >
          {DAY_FMT.format(startsAt)}
        </div>
      )}
      {timed && (
        <div className="font-display text-lg sm:text-xl">
          {formatTime(startsAt, { timeZone: 'UTC' })}
        </div>
      )}
      {timed && endsAt && hasTimeComponent(endsAt) && (
        <div className="font-mono text-xs opacity-80 sm:mt-1">
          → {formatTime(endsAt, { timeZone: 'UTC' })}
        </div>
      )}
    </div>
  );
}
