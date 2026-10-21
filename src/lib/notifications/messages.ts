// Message wording, kept pure so it can be tested without a server.
//
// Privacy floor (CLAUDE.md, ADR-0020): no PNRs, passport numbers, file
// names or document text. A file name is left out on purpose — booking
// confirmations are often saved under their reference number.

import type { EnsureSegmentOutcome } from '@/lib/documents/segment-link';

export interface DraftMessage {
  title: string;
  body: string;
  tags: string[];
  /** App path the notification opens, resolved against AUTH_URL at send time. */
  path: string;
}

function documentsPath(tripId: string): string {
  return `/trips/${tripId}/documents`;
}

function withTrip(tripTitle: string | null, detail: string): string {
  return tripTitle ? `${tripTitle} · ${detail}` : detail;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// Legs that ended up on the itinerary, whether newly created, refreshed
// or matched to an existing segment.
const LANDED = new Set(['linked-new', 'updated-prior', 'linked-existing', 'user-edited']);

export function extractionSucceededMessage(input: {
  tripId: string;
  tripTitle: string | null;
  outcome: EnsureSegmentOutcome | null;
}): DraftMessage {
  const { outcome } = input;
  let detail: string;
  if (outcome?.kind === 'linked') {
    const landed = outcome.items.filter((item) => LANDED.has(item.kind)).length;
    detail = landed > 0 ? `${plural(landed, 'segment')} added` : 'no segment added';
  } else if (outcome?.kind === 'already-linked') {
    detail = 'already on the itinerary';
  } else {
    detail = 'nothing to add';
  }
  return {
    title: 'Document read',
    body: withTrip(input.tripTitle, detail),
    tags: ['page_facing_up'],
    path: documentsPath(input.tripId),
  };
}

export function extractionFailedMessage(input: {
  tripId: string;
  tripTitle: string | null;
}): DraftMessage {
  return {
    title: 'Document not read',
    body: input.tripTitle ?? 'Trip documents',
    tags: ['warning'],
    path: documentsPath(input.tripId),
  };
}

export function testMessage(): DraftMessage {
  return {
    title: 'Atlas test',
    body: 'Notifications reach this device.',
    tags: ['white_check_mark'],
    path: '/settings',
  };
}
