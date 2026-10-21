// Conversions between Atlas's floating wall-clock times and real instants.
//
// Segment times are stored floating (ADR-0014/0016): a printed 06:00 is
// kept as 06:00 UTC and displayed as 06:00. Display never needs a zone.
// Scheduling does — a reminder has to fire at a real moment — so these
// helpers translate in both directions for a given IANA zone. They are
// for scheduling only; never render a time through them (ADR-0020).

// Formatter per zone, cached — Intl.DateTimeFormat construction is the
// expensive part and callers convert many times per zone.
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

/**
 * Offset of `tz` from UTC at the given instant, in ms: render the instant
 * as the zone's wall clock, re-encode that wall clock as if it were UTC,
 * and diff. Throws on an unknown zone.
 */
export function tzOffsetMs(tz: string, at: number): number {
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

/**
 * The real instant (epoch ms) at which a floating wall-clock time occurs
 * in `tz`, or null for an unknown zone (Intl throws). The floating Date's
 * UTC fields ARE the wall clock: subtract the zone's offset, then
 * re-check at the adjusted instant so a DST boundary between the two
 * doesn't skew the result by the transition amount.
 */
export function wallClockToEpoch(wallClock: Date, tz: string): number | null {
  try {
    const target = wallClock.getTime();
    let guess = target - tzOffsetMs(tz, target);
    guess = target - tzOffsetMs(tz, guess);
    return guess;
  } catch {
    return null;
  }
}

/**
 * The floating wall-clock time (as a UTC-encoded Date) that `tz` shows at
 * the instant `epochMs`, or null for an unknown zone. The inverse of
 * {@link wallClockToEpoch}.
 */
export function epochToWallClock(epochMs: number, tz: string): Date | null {
  try {
    return new Date(epochMs + tzOffsetMs(tz, epochMs));
  } catch {
    return null;
  }
}

/** True when `tz` is a zone this runtime's Intl knows. */
export function isKnownZone(tz: string): boolean {
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}
