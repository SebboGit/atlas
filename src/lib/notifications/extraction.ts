// Document-reading notifications, called from the extraction job in the
// worker. Kept here so the extraction pipeline only sees one call per
// outcome and none of the wording or recipient rules.

import type { EnsureSegmentOutcome } from '@/lib/documents/segment-link';
import { log } from '@/lib/log';

import { notificationsConfigured } from './index';
import { enqueueNotification } from './job';
import { extractionFailedMessage, extractionSucceededMessage } from './messages';
import { tripForNotification } from './repo';

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
  // Nothing can be sent without a server, so skip the query and the job.
  if (!notificationsConfigured()) return;
  // A re-extract started while this run was linking segments: the newer
  // job will report the real result, so this one stays quiet rather than
  // push a stale "no segment added" first.
  const { result } = input;
  if (
    result.ok &&
    result.outcome?.kind === 'linked' &&
    result.outcome.items.some((item) => item.kind === 'superseded')
  ) {
    return;
  }
  try {
    const trip = await tripForNotification(input.userId, input.tripId);
    const draft = result.ok
      ? extractionSucceededMessage({ tripId: input.tripId, trip, outcome: result.outcome })
      : extractionFailedMessage({ tripId: input.tripId, trip });
    await enqueueNotification({ ...draft, userId: input.userId, category: 'extraction' });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown' },
      'notifications.extraction.failed',
    );
  }
}
