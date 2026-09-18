import { log } from '@/lib/log';
import { DEFAULT_STORAGE_MAX_BYTES, requireStorageMaxBytes } from '@/lib/storage';

// Uploads have to clear two ceilings. Storage enforces STORAGE_MAX_BYTES at
// runtime, but the request envelope around the Server Action
// (`serverActions.bodySizeLimit` + `proxyClientMaxBodySize`) is sized from
// STORAGE_MAX_BYTES *at build time* and `output: 'standalone'` bakes it into
// the bundle. A body past the envelope is truncated, not rejected, so the
// action never runs and the upload dies as a generic "Something went wrong."
//
// The effective ceiling is therefore the lower of the two. next.config.ts
// publishes the baked value as ATLAS_UPLOAD_ENVELOPE_BYTES (no NEXT_PUBLIC_
// prefix: nothing client-side reads it, and the prefix would advertise a
// runtime knob this isn't — the value travels inlined in the bundle). This
// module is the one place that reconciles it with the runtime limit.

let warned = false;

/** The baked envelope, or `null` when this build published nothing usable. */
function bakedEnvelopeBytes(): number | null {
  const raw = process.env.ATLAS_UPLOAD_ENVELOPE_BYTES?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  // Same predicate as `readStorageMaxBytes()`: a whole number of bytes, so a
  // fractional envelope can't clamp uploads below the configured value.
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The largest upload the running image can actually accept: the runtime
 * STORAGE_MAX_BYTES clamped to the ceiling the request envelope was built
 * with. Server-side only — pass the result to client components as a prop.
 *
 * Throws the same error storage throws when STORAGE_MAX_BYTES is set to
 * something unparseable. A page that fails to render is the signal the
 * operator needs; silently advertising a default the storage layer would
 * then refuse to honour is worse than a loud failure.
 */
export function getUploadMaxBytes(): number {
  const runtime = requireStorageMaxBytes();

  // Nothing usable baked in means no ceiling we can trust (a non-Next
  // process, a test). Keep the runtime limit rather than clamping to a guess.
  const baked = bakedEnvelopeBytes();
  if (baked === null) return runtime;

  if (runtime > baked) {
    if (!warned) {
      warned = true;
      log.warn(
        { runtimeMaxBytes: runtime, bakedMaxBytes: baked },
        'STORAGE_MAX_BYTES exceeds the request-body envelope baked into this build; ' +
          'uploads are clamped to the baked ceiling. Rebuild the image with ' +
          '--build-arg STORAGE_MAX_BYTES=<bytes> to raise it.',
      );
    }
    return baked;
  }

  return runtime;
}

/**
 * `getUploadMaxBytes()` for read surfaces that merely need a number to hand
 * the upload dialog — trip browsing, which the household does far more often
 * than uploading.
 *
 * A misconfigured STORAGE_MAX_BYTES still has to be loud, but the loudness
 * belongs where the upload happens: the Documents tab and
 * `uploadDocumentAction` both call `getUploadMaxBytes()` and still throw on
 * it. An operator typo should not 500 `/trips/<id>/map` for everyone, so this
 * logs the error and falls back to the envelope the build was given — or the
 * default, when that is unusable too.
 */
export function getUploadMaxBytesOrFallback(): number {
  try {
    return getUploadMaxBytes();
  } catch (e) {
    const fallbackMaxBytes = bakedEnvelopeBytes() ?? DEFAULT_STORAGE_MAX_BYTES;
    log.error(
      { err: e instanceof Error ? e.message : String(e), fallbackMaxBytes },
      'Upload limit is misconfigured; falling back to the build-time envelope for this page.',
    );
    return fallbackMaxBytes;
  }
}
