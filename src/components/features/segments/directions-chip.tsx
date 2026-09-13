// Link-out chip that opens a transit leg's route in Google Maps
// (ADR-0019). Same quiet pill as the Plus Code badge; the URL comes from
// `transitDirectionsUrl`.

import { Route } from 'lucide-react';

import { mapChipClassName } from './plus-code-badge';

export function DirectionsChip({ href, label = 'Directions' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Directions in Google Maps"
      className={mapChipClassName}
    >
      <Route aria-hidden className="size-3.5" strokeWidth={1.75} />
      <span>{label}</span>
    </a>
  );
}
