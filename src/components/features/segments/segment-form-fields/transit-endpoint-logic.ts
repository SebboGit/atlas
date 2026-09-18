// Pure rules specific to the transit form's From / To blocks (ADR-0019),
// kept out of the components so they're tested without a DOM. The rules
// every pinned type shares — the pin line, the edited check, the dotted
// path reader — live in `place-pin-logic.ts`.

import { trimText, type PlacePaths } from './place-pin-logic';

export type EndpointSide = 'from' | 'to';

/** Form paths for each end. `address` / `plusCode` locate the destination. */
export const TRANSIT_ENDPOINT_PATHS: Readonly<Record<EndpointSide, PlacePaths>> = {
  from: { name: 'data.fromName', address: 'data.fromAddress', plusCode: 'data.fromPlusCode' },
  to: { name: 'data.toName', address: 'data.address', plusCode: 'data.plusCode' },
};

/**
 * Whether an end's "Address · Plus Code" section starts open: only when
 * the saved segment has an address without a Plus Code — the one case
 * where the hidden field is what locates the end. Decided once, from the
 * saved values, so the section never folds away while someone types in
 * it. A field error opens it regardless (see TransitEndpointFields).
 */
export function endpointSectionStartsOpen(saved: { address: unknown; plusCode: unknown }): boolean {
  return trimText(saved.address) !== '' && trimText(saved.plusCode) === '';
}
