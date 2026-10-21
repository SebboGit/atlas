// Document-reading notifications, called from the extraction job in the
// worker. Kept here so the extraction pipeline only sees one call per
// outcome and none of the wording or recipient rules.

import type { EnsureSegmentOutcome } from '@/lib/documents/segment-link';
import { log } from '@/lib/log';

import { enqueueNotification } from './job';
import { extractionFailedMessage, extractionSucceededMessage } from './messages';
import { tripTitleForUser } from './repo';

type ExtractionResult = { ok: true; outcome: EnsureSegmentOutcome | null } | { ok: false };

/**
 * Tell the uploader their document finished reading. Never throws — a
 * notification failure must not fail the extraction job, whose result
 * is already saved by the time this runs.
 */
export async function notifyExtractionFinished(input: {
  userId: string;
  tripId: string;
  result: ExtractionResult;
}): Promise<void> {
  try {
    const tripTitle = await tripTitleForUser(input.userId, input.tripId);
    const draft = input.result.ok
      ? extractionSucceededMessage({
          tripId: input.tripId,
          tripTitle,
          outcome: input.result.outcome,
        })
      : extractionFailedMessage({ tripId: input.tripId, tripTitle });
    await enqueueNotification({ ...draft, userId: input.userId, category: 'extraction' });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown' },
      'notifications.extraction.failed',
    );
  }
}
