// Origin / destination semantics for transit segments (ADR-0019).
// Pure and client-safe: the geocoder, the form prefill, the card and
// the Directions link all read "which end is which" through here so the
// rule lives in exactly one place.

import type { TransitData } from './validators';

// Modes that get two geocoded endpoints, station-aware search and a
// line on the trip map. car / other keep a single destination pin — a
// straight line would imply a road route we don't know.
export const TRANSIT_ENDPOINT_MODES = ['train', 'bus', 'ferry'] as const satisfies ReadonlyArray<
  TransitData['mode']
>;

export type TransitEndpointMode = (typeof TRANSIT_ENDPOINT_MODES)[number];

export function hasTransitEndpoints(mode: unknown): mode is TransitEndpointMode {
  return (TRANSIT_ENDPOINT_MODES as readonly unknown[]).includes(mode);
}

/** One end of a transit leg. Blank strings are normalised to null. */
export interface TransitEndpoint {
  name: string | null;
  address: string | null;
  plusCode: string | null;
}

export interface ResolvedTransitEndpoints {
  origin: TransitEndpoint;
  destination: TransitEndpoint;
}

function present(s: string | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

/**
 * `address` / `plusCode` always locate the destination, `fromAddress` /
 * `fromPlusCode` the origin — even on a row that only names its origin.
 * No shape-based exception: a row can't tell whether it predates the
 * origin fields, so guessing would misread new rows (ADR-0019).
 */
export function resolveTransitEndpoints(data: TransitData): ResolvedTransitEndpoints {
  return {
    origin: {
      name: present(data.fromName),
      address: present(data.fromAddress),
      plusCode: present(data.fromPlusCode),
    },
    destination: {
      name: present(data.toName),
      address: present(data.address),
      plusCode: present(data.plusCode),
    },
  };
}
