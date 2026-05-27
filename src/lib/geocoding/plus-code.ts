// Plus Code (Open Location Code) parsing + encode/decode helpers. Pure
// functions wrapping Google's `open-location-code` library. Used by the
// place resolver to short-circuit Plus Code inputs around Nominatim's
// free-text search, and by the card badge to encode any cached
// lat/lng back into a recognisable identifier.
//
// Two recognised input shapes:
//   - Full code:   8 alphabet chars + '+' + 2-3 alphabet chars (e.g. "8Q7XMPWG+5V")
//   - Local code:  4-6 alphabet chars + '+' + 2-3 alphabet chars, optionally
//                  followed by an anchor reference ("MP7J+CV Minato City, Tokyo")
//
// Case-insensitive on input; canonicalised uppercase on output.

import { OpenLocationCode } from 'open-location-code';

const olc = new OpenLocationCode();

// OLC's reduced alphabet — chosen to minimise the chance of codes
// spelling words. Case-insensitive in practice.
const OLC_CHAR_CLASS = '[23456789CFGHJMPQRVWX]';

// OLC spec: total code length 10–15 alphabet chars excluding the `+`,
// with the separator after exactly the 8th char. That leaves 2–7
// alphabet chars after `+` for a full code. Short/local codes follow
// the same suffix shape; the `before-+` part is just trimmed to 4–6
// for resolvable shortened forms.
const FULL_CODE_RE = new RegExp(`^${OLC_CHAR_CLASS}{8}\\+${OLC_CHAR_CLASS}{2,7}$`, 'i');
const LOCAL_CODE_RE = new RegExp(
  `^(${OLC_CHAR_CLASS}{4,6}\\+${OLC_CHAR_CLASS}{2,7})(?:\\s+(.+))?$`,
  'i',
);

export type ParsedPlusCode =
  | { kind: 'full'; code: string }
  | { kind: 'local'; code: string; reference: string | null };

/**
 * Recognise an input as either a full or local Plus Code. Returns
 * `null` for any string that doesn't structurally look like one — the
 * caller falls through to free-text geocoding.
 *
 * Whitespace tolerant; case-insensitive; canonicalises the code part to
 * uppercase. A bare local code (no anchor text) parses to
 * `kind: 'local'` with `reference: null` so the form layer can prompt
 * the user to add an anchor before save.
 */
export function tryParsePlusCode(input: string): ParsedPlusCode | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  if (FULL_CODE_RE.test(trimmed)) {
    return { kind: 'full', code: trimmed.toUpperCase() };
  }

  const local = LOCAL_CODE_RE.exec(trimmed);
  if (local) {
    const code = local[1]!.toUpperCase();
    const ref = local[2]?.trim();
    return { kind: 'local', code, reference: ref && ref !== '' ? ref : null };
  }

  return null;
}

/**
 * Schema-side validation: a non-empty input must be parseable AND, for
 * local codes, must carry an anchor. (A bare local code can't resolve
 * without one — better to reject at form time than to enqueue a job
 * that's guaranteed to fail.)
 *
 * Empty / whitespace-only is accepted — the Plus Code field is
 * optional at the schema level.
 */
export function isValidPlusCodeShape(input: string): boolean {
  if (input.trim() === '') return true;
  const parsed = tryParsePlusCode(input);
  if (parsed === null) return false;
  if (parsed.kind === 'local' && parsed.reference === null) return false;
  return true;
}

/**
 * Decode a full Plus Code to its center coordinates. Offline — no
 * network, no provider. Returns `null` if the library rejects the
 * input (defence in depth; valid-shape callers should never see this).
 */
export function decodePlusCode(code: string): { lat: number; lng: number } | null {
  try {
    const area = olc.decode(code);
    return { lat: area.latitudeCenter, lng: area.longitudeCenter };
  } catch {
    return null;
  }
}

/**
 * Lift a local Plus Code to its nearest full code using a reference
 * point. Pure / offline; returns `null` if the library rejects the
 * input.
 */
export function recoverPlusCode(localCode: string, refLat: number, refLng: number): string | null {
  try {
    return olc.recoverNearest(localCode, refLat, refLng);
  } catch {
    return null;
  }
}

/**
 * Encode coordinates as a full Plus Code. Used to render the badge for
 * segments whose coordinates came from a free-text address (so the
 * Plus Code identifier surfaces uniformly, regardless of how the
 * coords were obtained). Default 10-char precision — building-sized
 * (~14×14 m at the equator), matches the precision a user would type.
 */
export function encodePlusCode(lat: number, lng: number): string | null {
  try {
    return olc.encode(lat, lng);
  } catch {
    return null;
  }
}
