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
// `convert` directly, not the barrel: the barrel also loads the zone
// boundary lookup, which card rendering has no use for.
import { wallClockToEpoch } from '@/lib/timezones/convert';

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

  const dep = wallClockToEpoch(input.startsAt, originTz);
  const arr = wallClockToEpoch(input.endsAt, destTz);
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
