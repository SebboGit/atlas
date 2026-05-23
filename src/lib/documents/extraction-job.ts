// Background extraction job — runs in the worker process, registered
// in scripts/worker.ts. The server action in `./actions.ts` enqueues
// it via `getJobs().send(EXTRACTION_JOB, ...)` and returns immediately;
// the worker picks the job up and walks it through the OCR + LLM
// pipeline, finishing with a write back to the document row.
//
// Lifted out of `actions.ts` as part of the pg-boss migration (ADR-0012)
// so the worker can import the handler without dragging server-action
// concerns (`revalidatePath`, `'use server'`) into a non-request process.
//
// **Claim mechanism.** The action stamps `documents.extractionStartedAt`
// before enqueueing; that timestamp is the claim token. Every write the
// job makes back to the row is keyed on it — a superseded job (the user
// re-clicked, a fresh `markExtractionStarted` re-stamped the row) sees
// its persist write rejected and bows out cleanly. No revalidation from
// the worker: the `ExtractingAutoRefresh` poller in the UI picks up the
// new state on its next 4s tick. Cross-process `revalidatePath` doesn't
// work with Next.js's in-process cache anyway.

import {
  createOllamaExtractor,
  extractDocument,
  getDefaultDirectExtractors,
} from '@/lib/extraction';
import { log } from '@/lib/log';
import { getDefaultExtractors } from '@/lib/ocr';
import { getStorage } from '@/lib/storage';

import * as repo from './repo';
import { ensureSegmentForExtraction } from './segment-link';

export const EXTRACTION_JOB = 'extraction';

export interface ExtractionJobData {
  userId: string;
  tripId: string;
  documentId: string;
  /** ISO-8601 string. The claim token (`documents.extractionStartedAt`). */
  claim: string;
  /**
   * Segment IDs this document was linked to BEFORE `markExtractionStarted`
   * wiped the links. The bridge uses these to decide which dedup
   * matches are this document's own prior segments (update in place)
   * vs. another document's segments (link only, leave fields alone).
   * Empty on first extraction.
   */
  priorLinkedSegmentIds: string[];
}

export async function runExtractionJob(data: ExtractionJobData): Promise<void> {
  const { userId, tripId, documentId, priorLinkedSegmentIds } = data;
  const claim = new Date(data.claim);

  void tripId; // retained in payload for log enrichment / future routing

  const document = await repo.getByIdForUser(userId, documentId);
  if (!document) {
    log.warn({ documentId }, 'documents.extract.job.doc_missing');
    return;
  }

  let llm;
  try {
    llm = createOllamaExtractor();
  } catch (e) {
    // Lost-race: config went away between the action's check and the
    // job running. Release the in-progress flag — but only if it's
    // still our claim, so we don't undo a fresh re-click's setup.
    log.warn(
      {
        documentId,
        err: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown',
      },
      'documents.extract.job.config_lost',
    );
    await repo.clearExtractionStarted(userId, documentId, claim);
    return;
  }

  const result = await extractDocument(
    {
      objectKey: document.objectKey,
      mime: document.mime,
      bytes: document.bytes,
    },
    {
      storage: getStorage(),
      llm,
      extractors: getDefaultExtractors(),
      directExtractors: getDefaultDirectExtractors(),
    },
  );

  if (result.status === 'ok') {
    const persisted = await repo.recordExtraction(
      userId,
      documentId,
      {
        parsed: result.parsed,
        parsedBy: result.sourceMethod,
        parsedConfidence: result.confidence,
        textMethod: result.textMethod,
        extractionError: null,
      },
      claim,
    );
    if (!persisted) {
      log.warn({ documentId }, 'documents.extract.job.superseded_or_removed');
      return;
    }
    const outcome = await ensureSegmentForExtraction({
      userId,
      tripId,
      documentId,
      payload: result.parsed,
      priorLinkedSegmentIds,
      claim: { startedAt: claim },
    }).catch((e) => {
      log.warn(
        {
          documentId,
          err: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown',
        },
        'documents.extract.job.segment_link_threw',
      );
      return null;
    });
    if (outcome) {
      const detail =
        outcome.kind === 'linked'
          ? { items: outcome.items.map((i) => i.kind) }
          : outcome.kind === 'already-linked'
            ? { linkedCount: outcome.segmentIds.length }
            : {};
      log.info(
        { documentId, outcome: outcome.kind, ...detail },
        'documents.extract.job.segment_link',
      );
    }
    return;
  }

  const persisted = await repo.recordExtraction(
    userId,
    documentId,
    {
      parsed: null,
      parsedBy: null,
      parsedConfidence: null,
      textMethod: null,
      extractionError: result.reason,
    },
    claim,
  );
  if (!persisted) {
    log.warn({ documentId }, 'documents.extract.job.superseded_or_removed');
  }
}
