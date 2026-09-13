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
  /**
   * True for a pre-ADR-0019 row that only named its origin but carries
   * an `address` / `plusCode`. The old single-pin query fell back to
   * `fromName`, so those fields were the origin's all along.
   */
  legacyOriginOnly: boolean;
}

function present(s: string | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

export function resolveTransitEndpoints(data: TransitData): ResolvedTransitEndpoints {
  const fromName = present(data.fromName);
  const toName = present(data.toName);
  const fromAddress = present(data.fromAddress);
  const fromPlusCode = present(data.fromPlusCode);
  const address = present(data.address);
  const plusCode = present(data.plusCode);

  const legacyOriginOnly =
    toName === null &&
    fromName !== null &&
    fromAddress === null &&
    fromPlusCode === null &&
    (address !== null || plusCode !== null);

  if (legacyOriginOnly) {
    return {
      origin: { name: fromName, address, plusCode },
      destination: { name: null, address: null, plusCode: null },
      legacyOriginOnly,
    };
  }

  return {
    origin: { name: fromName, address: fromAddress, plusCode: fromPlusCode },
    destination: { name: toName, address, plusCode },
    legacyOriginOnly,
  };
}
