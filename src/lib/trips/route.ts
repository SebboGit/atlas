import { formatFlightNumber } from '@/lib/airlines';
import { flightDataSchema, transitDataSchema, type Segment } from '@/lib/segments';

/**
 * How the traveller reached a stop: by air, by a booked transit leg, or by a
 * transfer Atlas has no booking for (landing at HND, then a train from
 * "Tokyo Station").
 */
export type RouteLink = 'flight' | 'transit' | 'transfer';

export interface RouteStop {
  label: string;
  /** Link that arrives here; null for the first stop. */
  via: RouteLink | null;
  /** Short caption for the arriving link — a flight number or transit mode. */
  viaLabel: string | null;
  /** UTC day (`YYYY-MM-DD`) of the leg that arrives here; null for the start. */
  arrivedOn: string | null;
}

type RouteSegment = Pick<Segment, 'type' | 'data' | 'startsAt'>;

interface Leg {
  from: string;
  to: string;
  link: 'flight' | 'transit';
  caption: string | null;
  startsAt: number;
  day: string;
}

// Transit modes that move a trip between places. Buses, cars and "other"
// are mostly local hops (a station shuttle, a ryokan pickup) that would
// crowd the line without changing where the trip goes.
const ROUTE_MODES: ReadonlySet<string> = new Set(['train', 'ferry']);

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// "Kyoto Station" → "Kyoto"; "Tokyo Stn" → "Tokyo". Display-only: the
// diagram has room for a place, not a full station name.
function placeLabel(name: string): string {
  const trimmed = name.trim().replace(/\s+(station|stn\.?|terminal|pier)$/i, '');
  return trimmed || name.trim();
}

function toLeg(segment: RouteSegment): Leg | null {
  if (!segment.startsAt) return null;
  const day = utcDay(segment.startsAt);
  const startsAt = segment.startsAt.getTime();

  if (segment.type === 'flight') {
    const parsed = flightDataSchema.safeParse(segment.data);
    if (!parsed.success) return null;
    const { originAirport, destinationAirport, carrier, flightNumber } = parsed.data;
    if (!originAirport || !destinationAirport) return null;
    return {
      from: originAirport.toUpperCase(),
      to: destinationAirport.toUpperCase(),
      link: 'flight',
      caption: formatFlightNumber(carrier, flightNumber),
      startsAt,
      day,
    };
  }

  if (segment.type === 'transit') {
    const parsed = transitDataSchema.safeParse(segment.data);
    if (!parsed.success) return null;
    const { fromName, toName, mode } = parsed.data;
    if (!ROUTE_MODES.has(mode)) return null;
    if (!fromName?.trim() || !toName?.trim()) return null;
    return {
      from: placeLabel(fromName),
      to: placeLabel(toName),
      link: 'transit',
      caption: mode,
      startsAt,
      day,
    };
  }

  return null;
}

/**
 * The trip's route as an ordered list of stops, built from its dated flights
 * and train / ferry legs (both ends known). Consecutive legs that don't meet are
 * joined by a `transfer`. Fewer than two stops means there is no route to
 * draw, and an empty list comes back.
 */
export function buildTripRoute(segments: RouteSegment[]): RouteStop[] {
  const legs = segments
    .map(toLeg)
    .filter((leg): leg is Leg => leg !== null)
    .sort((a, b) => a.startsAt - b.startsAt);

  const stops: RouteStop[] = [];
  for (const leg of legs) {
    const last = stops[stops.length - 1];
    if (!last) {
      stops.push({ label: leg.from, via: null, viaLabel: null, arrivedOn: null });
    } else if (last.label.toLowerCase() !== leg.from.toLowerCase()) {
      stops.push({ label: leg.from, via: 'transfer', viaLabel: null, arrivedOn: leg.day });
    }
    stops.push({ label: leg.to, via: leg.link, viaLabel: leg.caption, arrivedOn: leg.day });
  }
  return stops.length >= 2 ? stops : [];
}
