// True elapsed duration of a flight from its floating-local times.
//
// ADR-0016 stores each end as the printed wall clock (interpreted at
// UTC), so the raw difference between the two Dates is meaningless
// across zones — a 10:30 → 17:30 Hanoi → Paris flight is 12h in the
// air, not 7. Each end is anchored to its airport's IANA timezone
// (from the committed airports snapshot) to recover the real instants,
// and the duration is their difference. DST transitions are handled by
// the two-pass offset resolve.

import { getAirportTimezone } from '@/lib/airports';

export interface FlightDurationInput {
  startsAt: Date | null;
  endsAt: Date | null;
  originAirport?: string | null;
  destinationAirport?: string | null;
}

/**
 * Minutes in the air, or null when it can't be computed honestly:
 * missing times, unknown airports/timezones, or a nonsensical result
 * (non-positive, or beyond the longest real airline route — bad data
 * like a wrong date should render nothing, not "-9h").
 */
export function flightDurationMinutes(input: FlightDurationInput): number | null {
  if (!input.startsAt || !input.endsAt) return null;
  const originTz = getAirportTimezone(input.originAirport);
  const destTz = getAirportTimezone(input.destinationAirport);
  if (!originTz || !destTz) return null;

  const dep = zonedEpoch(input.startsAt, originTz);
  const arr = zonedEpoch(input.endsAt, destTz);
  if (dep === null || arr === null) return null;

  const minutes = Math.round((arr - dep) / 60_000);
  if (minutes <= 0 || minutes > 26 * 60) return null;
  return minutes;
}

/** "12h 45m" / "2h" / "45m" — for the card subtitle. */
export function formatFlightDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// The floating Date's UTC fields ARE the printed wall clock. Find the
// real instant at which `tz` shows that wall clock: subtract the
// zone's offset, then re-check at the adjusted instant so a DST
// boundary between the two doesn't skew the result by the transition
// amount. Unknown IANA identifiers make Intl throw → null.
function zonedEpoch(wallClock: Date, tz: string): number | null {
  try {
    const target = wallClock.getTime();
    let guess = target - tzOffsetMs(tz, target);
    guess = target - tzOffsetMs(tz, guess);
    return guess;
  } catch {
    return null;
  }
}

// Formatter per zone, cached — flight lists render many cards and
// Intl.DateTimeFormat construction is the expensive part.
const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dtfCache.set(tz, dtf);
  }
  return dtf;
}

// Offset of `tz` from UTC at the given instant, in ms: render the
// instant as the zone's wall clock, re-encode that wall clock as if it
// were UTC, and diff.
function tzOffsetMs(tz: string, at: number): number {
  const parts = formatterFor(tz).formatToParts(new Date(at));
  const get = (type: string): number => {
    const v = parts.find((p) => p.type === type)?.value;
    return v === undefined ? 0 : Number(v);
  };
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - at;
}
