'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { trips } from '@/db/schema';
import { requireUser } from '@/lib/auth/session';
import {
  createOllamaExtractor,
  extractDocument,
  getDefaultDirectExtractors,
  structuredPayloadSchema,
} from '@/lib/extraction';
import { getJobs } from '@/lib/jobs';
import { log } from '@/lib/log';
import { getDefaultExtractors } from '@/lib/ocr';
import { getStorage, StorageRejectedError } from '@/lib/storage';
import { err, ok, type Result } from '@/types/result';

import * as repo from './repo';
import { ensureSegmentForExtraction } from './segment-link';
import { EXTRACTION_STALE_MS } from './state';

export type FormError = {
  formMessage?: string;
  fields?: Record<string, string>;
};

function revalidateTrip(tripId: string) {
  revalidatePath(`/trips/${tripId}`, 'layout');
}

// Same as `revalidateTrip`, but safe to call from inside a background
// job. Next.js 15 forbids `revalidatePath` while ANY render is active
// in the same process — and the InlineJobs body runs concurrently
// with the user's polling RSC fetches (ExtractingAutoRefresh ticks
// every 4s), so the check trips on every successful extraction.
//
// We swallow that specific error and rely on ExtractingAutoRefresh to
// pick up the new state on its next tick. Other shapes of error still
// bubble — those would be real misconfiguration. Single-user app
// scope: cross-tab freshness lags by up to the polling interval; the
// user is almost certainly looking at the Documents tab while a doc
// extracts anyway.
function revalidateTripFromJob(tripId: string): void {
  try {
    revalidatePath(`/trips/${tripId}`, 'layout');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('during render')) {
      // Expected when a poll-driven RSC fetch is in flight. Drop it
      // silently — ExtractingAutoRefresh will redraw on next tick.
      return;
    }
    throw err;
  }
}

export async function uploadDocumentAction(
  tripId: string,
  formData: FormData,
): Promise<Result<{ id: string; isNew: boolean }, FormError>> {
  const user = await requireUser();

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return err({ formMessage: 'Pick a file first.', fields: { file: 'Required.' } });
  }

  // Verify the user owns the trip before doing any storage I/O. Saves
  // a write on the unhappy path and keeps the action's behaviour
  // consistent with segment/trip mutations.
  const [owned] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.userId, user.id)))
    .limit(1);
  if (!owned) return err({ formMessage: 'Trip not found.' });

  const storage = getStorage();
  let put;
  try {
    put = await storage.put(file.stream(), {
      declaredMime: file.type || 'application/octet-stream',
      size: file.size,
      extHint: file.name,
    });
  } catch (e) {
    if (e instanceof StorageRejectedError) {
      const reason =
        e.reason === 'too-large'
          ? 'File is too large.'
          : e.reason === 'mime-not-allowed'
            ? "That file type isn't allowed. PDF and JPG/PNG/WebP/HEIC images only."
            : "File contents don't match the declared type.";
      return err({ formMessage: reason });
    }
    throw e;
  }

  const { document, isNew } = await repo.create(user.id, {
    tripId,
    objectKey: put.key,
    mime: put.mime,
    bytes: put.bytes,
    sha256: put.sha256,
    originalName: file.name,
  });

  // Idempotent re-upload: the existing row's file is the canonical
  // copy; the one we just wrote is orphaned and should go. Best-effort
  // — a failure here leaves a file the periodic sweep will clean up.
  if (!isNew) {
    await storage.delete(put.key).catch(() => undefined);
  }

  revalidateTrip(tripId);
  return ok({ id: document.id, isNew });
}

// Enqueue an extraction job against a document the user owns. The
// pipeline takes 30–90s on CPU Ollama, so this MUST NOT block the
// caller's request — we mark the row as "extraction started" (with
// `extractionStartedAt = NOW()`) synchronously, hand the actual work
// to the Jobs interface, and return immediately. The UI shows
// "Extracting…" until the job clears the flag (via `recordExtraction`).
//
// Returns ok({ status: 'queued' }) on success — the work hasn't run
// yet. Validation failures (auth, doc not found, Ollama not
// configured) still return err synchronously, since those can be
// detected without touching the storage layer.
export async function extractDocumentAction(
  tripId: string,
  documentId: string,
): Promise<Result<{ status: 'queued' }, FormError>> {
  const user = await requireUser();

  const document = await repo.getByIdForUser(user.id, documentId);
  if (!document) return err({ formMessage: 'Document not found.' });

  // Cross-check that the supplied tripId matches the document's own
  // tripId. The client could submit any of the user's own trip IDs
  // alongside any of their own document IDs; without this check, a
  // mismatched pair would create segments on the wrong trip and
  // revalidate the wrong path. Not a cross-tenant leak (still the
  // same user) but a real defect — refuse instead of silently
  // landing on the wrong trip.
  if (document.tripId !== tripId) {
    return err({ formMessage: 'Document does not belong to this trip.' });
  }

  // Cheap upfront config check — surface the misconfiguration on the
  // synchronous return path so the user gets feedback in their click,
  // not silently from a job that never produces a result.
  try {
    createOllamaExtractor();
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Extraction is not configured.';
    log.warn({ documentId, err: message }, 'documents.extract.not_configured');
    return err({ formMessage: 'Extraction is not configured on this server.' });
  }

  // Reactive sweep: any row this user owns that's been "extracting"
  // longer than the stale window probably belongs to a crashed prior
  // Node process. Clearing the flag here means the UI's stale-window
  // check and this query agree on what's live, and the user can
  // re-trigger without admin help. Cheap — one indexed-ish UPDATE.
  await repo
    .resetStaleExtractions(user.id, EXTRACTION_STALE_MS)
    .catch((e) =>
      log.warn(
        { err: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown' },
        'documents.extract.sweep_failed',
      ),
    );

  // Stamp the row so the UI flips to "Extracting…" the moment the
  // user's RSC refreshes (the action calls revalidateTrip below).
  // markExtractionStarted clears any prior `parsed` / `extractionError`
  // and the document_segments links — re-running Extract starts from a
  // clean slate. The returned `extractionStartedAt` is our **claim
  // token** for this job; `priorLinkedSegmentIds` lets the segment-
  // link bridge update segments this document previously owned
  // instead of leaving them stale (ADR-0008 follow-up).
  const marked = await repo.markExtractionStarted(user.id, documentId);
  if (!marked || !marked.document.extractionStartedAt) {
    return err({ formMessage: 'Document not found.' });
  }
  const claim = marked.document.extractionStartedAt;
  const priorLinkedSegmentIds = marked.priorLinkedSegmentIds;

  revalidateTrip(tripId);

  // Schedule the actual work. The closure captures everything it
  // needs; the InlineJobs implementation catches and logs any throw
  // from the handler. We don't await — the action returns now.
  getJobs().enqueue(async () => {
    await runExtractionJob({
      userId: user.id,
      tripId,
      documentId,
      claim,
      priorLinkedSegmentIds,
    });
  });

  return ok({ status: 'queued' });
}

// Body of the extraction job. Extracted into its own function so the
// action stays readable and so a future BullMQ-backed Jobs
// implementation can register this directly as a handler. The `claim`
// is the timestamp `markExtractionStarted` returned — every write
// back to the row is keyed on it so a superseded job (the user
// re-clicked, a fresh markExtractionStarted re-stamped the row) can
// see its persist write rejected and bow out cleanly.
async function runExtractionJob(args: {
  userId: string;
  tripId: string;
  documentId: string;
  claim: Date;
  /**
   * Segment IDs this document was linked to BEFORE `markExtractionStarted`
   * wiped the links. The bridge uses these to decide which dedup matches
   * are this document's own prior segments (update in place) vs. another
   * document's segments (link only, leave fields alone). Empty on first
   * extraction.
   */
  priorLinkedSegmentIds: string[];
}): Promise<void> {
  const { userId, tripId, documentId, claim, priorLinkedSegmentIds } = args;

  // Re-read the row inside the job: it might have been deleted
  // between the click and now. Same reason every step that mutates
  // a document scopes by (id, userId) — defensive on principle.
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
    revalidateTripFromJob(tripId);
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
      // Either the doc was deleted, or this job was superseded by a
      // re-click. Either way, NOT our row to touch. The newer job
      // (or absence) wins.
      log.warn({ documentId }, 'documents.extract.job.superseded_or_removed');
      return;
    }
    // ADR-0008: try to create + link the corresponding segment on
    // the trip. Best-effort — a failure here leaves the row with
    // `parsed` set and segmentId null, which the user resolves by
    // re-clicking Extract (dedup picks up any orphaned segment).
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
      // Multi-flight outcomes also surface the per-leg breakdown so
      // a partial failure (e.g. 2 legs linked, 1 create-failed) is
      // visible in the log without scraping the warn lines.
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
    revalidateTripFromJob(tripId);
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
    return;
  }
  revalidateTripFromJob(tripId);
}

// User-edit of the extracted `parsed` payload. Re-extract reaches
// for the LLM; this is the fast-fix path for "the model got one
// field slightly wrong" — fix it inline on the doc card, no
// round-trip.
//
// Scope: doc-only. The edit never propagates to a linked segment.
// Earlier iterations did propagate, but that broke invariants in
// the multi-doc-per-segment case (family of travellers on one
// flight): editing one doc's view of the flight would silently
// rewrite the shared segment's data — and the OTHER docs' parsed
// payloads would still disagree, leaving the trip view at odds
// with most of its source documents. It also broke dedup: future
// docs trying to attach to the same flight would no longer match
// the segment's mutated key.
//
// Three concerns, three paths:
//   - Re-extract  → "the LLM was wrong, retry"  (extractDocumentAction)
//   - Edit parsed → "fix this one doc's view"   (this action)
//   - Edit segment → "fix the trip event"        (updateSegmentAction)
//
// The user picks the right tool for what they're trying to fix.
export async function updateParsedAction(
  tripId: string,
  documentId: string,
  raw: unknown,
): Promise<Result<{ id: string }, FormError>> {
  const user = await requireUser();

  const parsed = structuredPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (key && fields[key] === undefined) fields[key] = issue.message;
    }
    return err({ fields, formMessage: 'Please fix the highlighted fields.' });
  }

  // Cross-check that the supplied tripId matches the document's own
  // tripId. The client could submit any of the user's trip IDs
  // alongside any of their document IDs; without this, the wrong
  // path would be revalidated. Same family as the check in
  // `extractDocumentAction`.
  const existing = await repo.getByIdForUser(user.id, documentId);
  if (!existing) return err({ formMessage: 'Document not found.' });
  if (existing.tripId !== tripId) {
    return err({ formMessage: 'Document does not belong to this trip.' });
  }

  const doc = await repo.updateParsed(user.id, documentId, parsed.data);
  if (!doc) {
    // The predicate-update can reject for two reasons: doc is gone
    // (or never owned by this user), or extraction is in flight.
    // Re-read to distinguish so the user sees a useful message.
    const existing = await repo.getByIdForUser(user.id, documentId);
    if (!existing) return err({ formMessage: 'Document not found.' });
    if (existing.extractionStartedAt) {
      return err({
        formMessage:
          'Extraction is in progress. Wait for it to finish, then make your edits on the fresh result.',
      });
    }
    return err({ formMessage: 'Document not found.' });
  }

  revalidateTrip(tripId);
  return ok({ id: doc.id });
}

export async function deleteDocumentAction(
  tripId: string,
  id: string,
): Promise<Result<null, FormError>> {
  const user = await requireUser();

  // Cross-check that the supplied tripId matches the document's own
  // tripId before deleting. Same family as the check in
  // `extractDocumentAction`. Refuse rather than silently revalidate
  // the wrong path after a destructive operation.
  const existing = await repo.getByIdForUser(user.id, id);
  if (!existing) return err({ formMessage: 'Document not found.' });
  if (existing.tripId !== tripId) {
    return err({ formMessage: 'Document does not belong to this trip.' });
  }

  const removed = await repo.hardDelete(user.id, id);
  if (!removed) return err({ formMessage: 'Document not found.' });

  // The row is gone; reclaim the underlying file. Idempotent — fine if
  // the file is already missing.
  const storage = getStorage();
  await storage.delete(removed.objectKey).catch(() => undefined);

  revalidateTrip(tripId);
  return ok(null);
}
