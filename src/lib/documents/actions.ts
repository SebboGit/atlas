'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { trips } from '@/db/schema';
import { requireUser } from '@/lib/auth/session';
import { createOllamaExtractor, structuredPayloadSchema } from '@/lib/extraction';
import { getJobs } from '@/lib/jobs';
import { log } from '@/lib/log';
import { getStorage, StorageRejectedError } from '@/lib/storage';
import { err, ok, type Result } from '@/types/result';

import { EXTRACTION_JOB, type ExtractionJobData } from './extraction-job';
import * as repo from './repo';
import { EXTRACTION_STALE_MS } from './state';

export type FormError = {
  formMessage?: string;
  fields?: Record<string, string>;
};

function revalidateTrip(tripId: string) {
  revalidatePath(`/trips/${tripId}`, 'layout');
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

  // Enqueue durably. The worker process consumes the job; this action
  // returns the moment the row hits `pgboss.job`. If the persist fails
  // we MUST roll back the extraction claim — otherwise the doc is
  // marked extracting with no job behind it, the UI hangs on
  // "Extracting…" indefinitely, and only the stale-extraction sweep
  // on the next user click eventually unsticks it. Clear the claim,
  // revalidate, return a user-actionable error.
  const payload: ExtractionJobData = {
    userId: user.id,
    tripId,
    documentId,
    claim: claim.toISOString(),
    priorLinkedSegmentIds,
  };
  try {
    await getJobs().send(EXTRACTION_JOB, payload);
  } catch (e) {
    log.error(
      { documentId, err: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown' },
      'documents.extract.enqueue_failed',
    );
    // Compensating rollback. If this ALSO fails, the doc is stuck
    // with `extractionStartedAt` set but no pg-boss job behind it.
    // We don't rethrow — the user-facing path returns a friendly
    // error either way, and the user's next click recovers via the
    // stale-extraction sweep at the top of this action. Logging the
    // rollback failure separately is what surfaces it to operators.
    try {
      await repo.clearExtractionStarted(user.id, documentId, claim);
    } catch (clearErr) {
      log.error(
        {
          documentId,
          err: clearErr instanceof Error ? `${clearErr.name}: ${clearErr.message}` : 'unknown',
        },
        'documents.extract.enqueue_rollback_failed',
      );
    }
    revalidateTrip(tripId);
    return err({ formMessage: 'Could not queue extraction. Please try again.' });
  }

  return ok({ status: 'queued' });
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
