// Single source of truth for the MIME types Atlas's storage adapter
// knows how to validate. Both server (FilesystemStorage default config)
// and client (DocumentUploadDialog `accept` attribute) read from here
// so they cannot silently drift — that drift is exactly what made the
// .pkpass / .eml feature land as dead code in the previous slice.
//
// Pure data, no server-only imports. Safe to import from `'use client'`
// components.
//
// The server-side `STORAGE_ALLOWED_MIMES` env var (see src/lib/storage/fs.ts)
// can NARROW this set per deployment but never widen it — anything not
// listed below has no structural validator and would be unsafe to accept.

/**
 * MIMEs whose magic-byte signature `file-type` can identify on its own.
 * Safe to widen via env; magic-byte sniffing is the gate.
 */
export const SNIFFABLE_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

/**
 * MIMEs `file-type` cannot identify by magic bytes but for which we
 * carry our own structural validator (see fs.ts → `validateUnsniffable`).
 * Adding a new MIME here REQUIRES adding a matching validator.
 */
export const UNSNIFFABLE_MIMES = ['application/vnd.apple.pkpass', 'message/rfc822'] as const;

/**
 * Default server-side allowlist when `STORAGE_ALLOWED_MIMES` env is
 * unset. Also the upper bound of what the client picker advertises.
 */
export const DEFAULT_ALLOWED_MIMES: readonly string[] = [...SNIFFABLE_MIMES, ...UNSNIFFABLE_MIMES];

/**
 * Comma-separated form for the `<input type="file" accept="…">`
 * attribute. Browsers also accept extension hints (`.pkpass`, `.eml`),
 * which we add explicitly because pkpass and eml don't have a widely
 * recognised MIME-to-extension mapping in browser file pickers.
 */
export const DEFAULT_FILE_INPUT_ACCEPT: string = [...DEFAULT_ALLOWED_MIMES, '.pkpass', '.eml'].join(
  ',',
);

/**
 * Human-readable form for UI hints. Order matches the client picker.
 */
export const DEFAULT_FILE_INPUT_ACCEPT_HUMAN: string =
  'PDF · JPG · PNG · WebP · HEIC · Apple Wallet · Email';

/**
 * Friendly label for a MIME type — what users actually expect to read
 * ("Email", not "message/rfc822"). Shared between the upload dialog
 * (pre-upload preview reads `File.type`) and the document card
 * (post-upload reads the stored `Document.mime`) so both surfaces
 * agree on the wording.
 *
 * For sniffable types we render the subtype upper-cased as a fallback;
 * for null / empty / unknown inputs (some browsers leave `File.type`
 * blank for unrecognised extensions) we return a polite placeholder
 * rather than an empty string.
 */
export function formatMimeLabel(mime: string | null | undefined): string {
  if (!mime) return 'Unknown type';
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'image/jpeg') return 'JPEG';
  if (mime === 'image/png') return 'PNG';
  if (mime === 'image/webp') return 'WebP';
  if (mime === 'image/heic') return 'HEIC';
  if (mime === 'application/vnd.apple.pkpass') return 'Apple Wallet';
  if (mime === 'message/rfc822') return 'Email';
  const sub = mime.split('/')[1] ?? mime;
  return sub.toUpperCase();
}
