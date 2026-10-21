// Message wording, kept pure so it can be tested without a server.
//
// Privacy floor (CLAUDE.md, ADR-0020): no PNRs, passport numbers, file
// names or document text. A file name is left out on purpose — booking
// confirmations are often saved under their reference number.

import type { EnsureSegmentOutcome } from '@/lib/documents/segment-link';

export interface DraftMessage {
  title: string;
  body: string;
  /**
   * The body to use when the message goes to the deployment's shared
   * default topic and names a private trip: everyone subscribed to that
   * topic would see it, so the trip name is left out (ADR-0015). Absent
   * when `body` is already safe to share.
   */
  sharedTopicBody?: string;
  tags: string[];
  /** App path the notification opens, resolved against AUTH_URL at send time. */
  path: string;
}

function documentsPath(tripId: string): string {
  return `/trips/${tripId}/documents`;
}

export interface TripRef {
  title: string;
  isPrivate: boolean;
}

function withTrip(trip: TripRef | null, detail: string): string {
  return trip ? `${trip.title} · ${detail}` : detail;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// Legs that ended up on the itinerary, whether newly created, refreshed
// or matched to an existing segment.
const LANDED = new Set(['linked-new', 'updated-prior', 'linked-existing', 'user-edited']);

export function extractionSucceededMessage(input: {
  tripId: string;
  trip: TripRef | null;
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
    body: withTrip(input.trip, detail),
    ...(input.trip?.isPrivate ? { sharedTopicBody: detail } : {}),
    tags: ['page_facing_up'],
    path: documentsPath(input.tripId),
  };
}

export function extractionFailedMessage(input: {
  tripId: string;
  trip: TripRef | null;
}): DraftMessage {
  const generic = 'Trip documents';
  return {
    title: 'Document not read',
    body: input.trip?.title ?? generic,
    ...(input.trip?.isPrivate ? { sharedTopicBody: generic } : {}),
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
