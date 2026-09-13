// Google Maps directions link for a transit segment (ADR-0019). A plain
// URL the user opens in their own browser — no API key, no server call.
// Pure, so the per-mode rules are tested without rendering a card.

// Leaf imports (not the barrels) so client cards don't pull the geocoding
// cache or the segments repo into the browser bundle.
import { decodePlusCode, tryParsePlusCode } from '@/lib/geocoding/plus-code';
import { hasTransitEndpoints, resolveTransitEndpoints } from '@/lib/segments/transit-endpoints';
import type { TransitData } from '@/lib/segments/validators';

// A Plus Code as Google Maps reads it: a full code decoded to `lat,lng`,
// a local code with its anchor passed as typed.
function plusCodeValue(code: string | null): string | null {
  if (!code) return null;
  const parsed = tryParsePlusCode(code);
  if (!parsed) return null;
  if (parsed.kind === 'full') {
    const coords = decodePlusCode(parsed.code);
    return coords ? `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}` : null;
  }
  return parsed.reference ? code.trim() : null;
}

function present(s: string | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

/**
 * Directions from one end of the leg to the other, or null when either
 * end is missing (or both are the same). Each end is its station name
 * first — Google resolves "Tokyo Station" well, while a Plus Code saved
 * by an older edit may carry a wrong geocode — then its Plus Code, then
 * its address. Cached geocode coordinates are never used. car / other
 * have no origin location fields, so their origin is the From name.
 */
export function transitDirectionsUrl(data: TransitData): string | null {
  let origin: string | null;
  let destination: string | null;
  if (hasTransitEndpoints(data.mode)) {
    const ends = resolveTransitEndpoints(data);
    origin = ends.origin.name ?? plusCodeValue(ends.origin.plusCode) ?? ends.origin.address;
    destination =
      ends.destination.name ?? plusCodeValue(ends.destination.plusCode) ?? ends.destination.address;
  } else {
    origin = present(data.fromName);
    destination =
      present(data.toName) ?? plusCodeValue(present(data.plusCode)) ?? present(data.address);
  }
  if (!origin || !destination || origin.toLowerCase() === destination.toLowerCase()) return null;

  const travelMode = hasTransitEndpoints(data.mode)
    ? 'transit'
    : data.mode === 'car'
      ? 'driving'
      : null;
  return (
    'https://www.google.com/maps/dir/?api=1' +
    `&origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}` +
    (travelMode ? `&travelmode=${travelMode}` : '')
  );
}
