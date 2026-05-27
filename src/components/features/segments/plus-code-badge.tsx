// Monospace Plus Code badge that doubles as a Google Maps deep link.
// Renders on any segment / wishlist card that has cached coordinates,
// encoding lat/lng → full Plus Code on the fly (offline, microseconds —
// no cache key, no DB lookup). Clicking opens the Maps app via
// Universal Link on iOS/Android, or the Maps web place card on desktop.
//
// `venue` is the title that should anchor the deep link (hotel
// property name, food venue, activity title, transit destination).
// When supplied, the URL biases Google Maps to that name AT the coords
// so the user lands on the place card. Without it, Maps just drops a
// pin at the coords.

import { MapPin } from 'lucide-react';
import * as React from 'react';

// Leaf import (not the barrel) so this component — used inside client
// cards — doesn't pull the geocoding cache / pg driver into the
// browser bundle.
import { encodePlusCode } from '@/lib/geocoding/plus-code';

interface PlusCodeBadgeProps {
  lat: number;
  lng: number;
  /** Title/name to bias the Maps result toward — typically the segment's headline. */
  venue?: string | null;
}

export function PlusCodeBadge({ lat, lng, venue }: PlusCodeBadgeProps) {
  const code = encodePlusCode(lat, lng);
  if (code === null) return null;

  const href = googleMapsUrl({ lat, lng, venue });

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={venue ? `Open ${venue} in Google Maps` : 'Open in Google Maps'}
      // `@media (hover: none)` (= touch devices, per CLAUDE.md) gets a
      // 44 px hit area so the link is tappable; pointer devices keep
      // the compact pill so the badge stays a quiet decorative chip.
      className="border-foreground/20 bg-foreground/[0.04] text-foreground/80 hover:bg-foreground/[0.08] hover:text-foreground hover:border-foreground/35 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-none transition-colors [@media(hover:none)]:min-h-11 [@media(hover:none)]:px-3 [@media(hover:none)]:py-2.5"
    >
      <MapPin aria-hidden className="size-3.5" strokeWidth={1.75} />
      <span className="font-mono tracking-wide">{code}</span>
    </a>
  );
}

/**
 * Compose a subtitle line that flows the existing text parts and the
 * Plus Code badge on a single (wrapping) row. Used by every segment
 * card variant — extracted here so the layout stays consistent across
 * hotel / food / activity / transit / wishlist.
 *
 * Returns `undefined` when there's neither text nor coords, so the
 * card shell hides the whole subtitle line cleanly. Coords with NaN /
 * Infinity defensively suppress the badge (the encoder rejects them
 * anyway).
 */
export function subtitleWithPlusCodeBadge({
  parts,
  coords,
  venue,
}: {
  parts: ReadonlyArray<string | null | undefined>;
  coords?: { lat: number; lng: number } | null;
  venue?: string | null;
}): React.ReactNode {
  const text = parts
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .join(' · ');
  // Probe `encodePlusCode` directly (not just isFinite) so we don't
  // render an empty wrapper when coords pass the finite check but the
  // encoder rejects them (out-of-range, library edge case).
  const code =
    coords !== null && coords !== undefined ? encodePlusCode(coords.lat, coords.lng) : null;
  const hasBadge = code !== null && coords !== null && coords !== undefined;
  if (text === '' && !hasBadge) return undefined;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {text !== '' && <span>{text}</span>}
      {hasBadge && <PlusCodeBadge lat={coords.lat} lng={coords.lng} venue={venue ?? null} />}
    </span>
  );
}

/**
 * Compose a Google Maps deep link. Exported for unit testing the
 * URL-construction logic without a DOM render. Bare lat/lng drops a
 * pin; supplying `venue` biases Maps toward that place card.
 */
export function googleMapsUrl({
  lat,
  lng,
  venue,
}: {
  lat: number;
  lng: number;
  venue?: string | null;
}): string {
  const base = 'https://www.google.com/maps/search/?api=1&query=';
  const coords = `${lat},${lng}`;
  const trimmedVenue = venue?.trim();
  if (trimmedVenue) {
    return `${base}${encodeURIComponent(trimmedVenue)}+${coords}`;
  }
  return `${base}${coords}`;
}
