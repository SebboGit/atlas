// Pure rules behind the transit form's From / To blocks (ADR-0019), kept
// out of the components so they're tested without a DOM.

// Leaf import (not the barrel) so the form never pulls the geocoding
// cache into the browser bundle.
import { encodePlusCode, isValidPlusCodeShape } from '@/lib/geocoding/plus-code';

export type EndpointSide = 'from' | 'to';

/** Form paths for each end. `address` / `plusCode` locate the destination. */
export const TRANSIT_ENDPOINT_PATHS: Readonly<
  Record<EndpointSide, { name: string; address: string; plusCode: string }>
> = {
  from: { name: 'data.fromName', address: 'data.fromAddress', plusCode: 'data.fromPlusCode' },
  to: { name: 'data.toName', address: 'data.address', plusCode: 'data.plusCode' },
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Value at a dotted form path (`data.fromName`) in a values object. */
export function valueAt(values: unknown, path: string): unknown {
  let current: unknown = values;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Whether an end's name, address or Plus Code differs from the saved
 * segment. Blank and missing count as equal: the form holds '' for a key
 * the saved data never had.
 */
export function endpointEdited(
  current: { name: unknown; address: unknown; plusCode: unknown },
  saved: { name: unknown; address: unknown; plusCode: unknown },
): boolean {
  return (
    text(current.name) !== text(saved.name) ||
    text(current.address) !== text(saved.address) ||
    text(current.plusCode) !== text(saved.plusCode)
  );
}

export type EndpointPinLine =
  | { state: 'pinned'; code: string; detail: string | null }
  | { state: 'located'; code: string; detail: string | null };

/**
 * The line under an end's name saying where it sits on the map:
 *   - `pinned` — a saved or typed Plus Code the form will accept, with the
 *     address as detail;
 *   - `located` — no code, but the saved segment's geocode placed this
 *     end. Shown only while the end is unchanged and has something to
 *     locate by, since an edited or empty end no longer points at that
 *     spot. Display-only: the code is never written into the form, so it
 *     can't freeze the pin.
 */
export function endpointPinLine(args: {
  name: unknown;
  plusCode: unknown;
  address: unknown;
  located: { lat: number; lng: number; city?: string | null } | null | undefined;
  edited: boolean;
}): EndpointPinLine | null {
  const code = text(args.plusCode);
  if (code !== '' && isValidPlusCodeShape(code)) {
    return { state: 'pinned', code, detail: text(args.address) || null };
  }
  const identified = text(args.name) !== '' || text(args.address) !== '';
  if (args.located && identified && !args.edited) {
    const encoded = encodePlusCode(args.located.lat, args.located.lng);
    if (encoded !== null) {
      return { state: 'located', code: encoded, detail: args.located.city ?? null };
    }
  }
  return null;
}

/**
 * Whether an end's "Address · Plus Code" section starts open: only when
 * the saved segment has an address without a Plus Code — the one case
 * where the hidden field is what locates the end. Decided once, from the
 * saved values, so the section never folds away while someone types in
 * it. A field error opens it regardless (see TransitEndpointFields).
 */
export function endpointSectionStartsOpen(saved: { address: unknown; plusCode: unknown }): boolean {
  return text(saved.address) !== '' && text(saved.plusCode) === '';
}
