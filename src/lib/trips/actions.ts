'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/db/client';
import { documents, trips } from '@/db/schema';
import { requireUser } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { getStorage } from '@/lib/storage';
import { err, ok, type Result } from '@/types/result';

import * as repo from './repo';
import { tripCreateInput, tripUpdateInput } from './validators';

// Surfaced to forms via the Result return type. `fields` mirrors
// React Hook Form's `setError` shape so the client can drop field-level
// messages straight onto inputs without inventing a translation layer.
export type FormError = {
  formMessage?: string;
  fields?: Record<string, string>;
};

function flattenZod(error: z.ZodError): FormError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (key && fields[key] === undefined) fields[key] = issue.message;
  }
  return { fields, formMessage: 'Please fix the highlighted fields.' };
}

export async function createTripAction(raw: unknown): Promise<Result<{ id: string }, FormError>> {
  const user = await requireUser();
  const parsed = tripCreateInput.safeParse(raw);
  if (!parsed.success) return err(flattenZod(parsed.error));

  const trip = await repo.create(user.id, parsed.data);
  revalidatePath('/trips');
  return ok({ id: trip.id });
}

export async function updateTripAction(
  id: string,
  raw: unknown,
): Promise<Result<{ id: string }, FormError>> {
  const user = await requireUser();
  const parsed = tripUpdateInput.safeParse(raw);
  if (!parsed.success) return err(flattenZod(parsed.error));

  const trip = await repo.update(user.id, id, parsed.data);
  if (!trip) return err({ formMessage: 'Trip not found.' });

  revalidatePath('/trips');
  revalidatePath(`/trips/${id}`);
  return ok({ id: trip.id });
}

export async function archiveTripAction(id: string): Promise<Result<{ id: string }, FormError>> {
  const user = await requireUser();
  const trip = await repo.archive(user.id, id);
  if (!trip) return err({ formMessage: 'Trip not found.' });

  revalidatePath('/trips');
  revalidatePath(`/trips/${id}`);
  return ok({ id: trip.id });
}

export async function unarchiveTripAction(id: string): Promise<Result<{ id: string }, FormError>> {
  const user = await requireUser();
  const trip = await repo.unarchive(user.id, id);
  if (!trip) return err({ formMessage: 'Trip not found.' });

  revalidatePath('/trips');
  revalidatePath(`/trips/${id}`);
  return ok({ id: trip.id });
}

export interface DeleteTripOptions {
  /**
   * Whether to also hard-delete documents attached to this trip
   * (rows + underlying files). When false, the trip is deleted, the
   * documents' FKs auto-null, and the rows are stamped with
   * `orphanedAt = NOW()` so the future periodic sweep can reclaim
   * them on the user's grace-period schedule.
   *
   * Defaults to `true` — matches the user's expectation that "delete
   * the trip" cleans up its files. The dialog surfaces an explicit
   * opt-out checkbox when the trip has attached documents.
   */
  deleteDocuments?: boolean;
}

// Hard delete redirects on success — there's no detail page to return
// to. Archive stays on the detail page so the user can undo.
//
// Document handling is decided by the caller via `deleteDocuments`
// (see DeleteTripOptions). Both paths are atomic w.r.t. the DB: the
// trip delete and the doc cleanup happen in a single transaction.
// File-system cleanup runs after the transaction commits and is
// best-effort; a failed `storage.delete` leaves a stale file that the
// cleanup script / future sweep will reclaim.
export async function deleteTripAction(
  id: string,
  options: DeleteTripOptions = {},
): Promise<Result<null, FormError>> {
  const user = await requireUser();
  const deleteDocuments = options.deleteDocuments ?? true;

  // Capture attached documents BEFORE the trip delete: the FK is
  // `ON DELETE SET NULL`, so once the trip is gone we can't recover
  // which docs were linked to it. We need both the IDs (for row work)
  // and the objectKeys (for file work after the tx commits).
  type AttachedDoc = { id: string; objectKey: string };
  let attachedDocs: AttachedDoc[] = [];
  let tripExisted = false;

  try {
    await db.transaction(async (tx) => {
      attachedDocs = await tx
        .select({ id: documents.id, objectKey: documents.objectKey })
        .from(documents)
        .where(and(eq(documents.tripId, id), eq(documents.userId, user.id)));

      const deletedRows = await tx
        .delete(trips)
        .where(and(eq(trips.id, id), eq(trips.userId, user.id)))
        .returning({ id: trips.id });

      tripExisted = deletedRows.length > 0;
      if (!tripExisted) return;

      if (attachedDocs.length === 0) return;
      const docIds = attachedDocs.map((d) => d.id);

      if (deleteDocuments) {
        await tx
          .delete(documents)
          .where(and(inArray(documents.id, docIds), eq(documents.userId, user.id)));
      } else {
        await tx
          .update(documents)
          .set({ orphanedAt: new Date() })
          .where(and(inArray(documents.id, docIds), eq(documents.userId, user.id)));
      }
    });
  } catch (e) {
    log.error(
      { tripId: id, err: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown' },
      'trips.delete.tx_failed',
    );
    return err({ formMessage: 'Could not delete the trip. Try again.' });
  }

  if (!tripExisted) return err({ formMessage: 'Trip not found.' });

  // Reclaim files for docs we actually deleted (rows already gone, so
  // a failure here just leaves an orphan file — best-effort, the
  // cleanup script and the future sweep both handle that case).
  if (deleteDocuments && attachedDocs.length > 0) {
    const storage = getStorage();
    await Promise.all(
      attachedDocs.map((d) =>
        storage.delete(d.objectKey).catch((e) => {
          log.warn(
            {
              objectKey: d.objectKey,
              err: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown',
            },
            'trips.delete.file_unlink_failed',
          );
        }),
      ),
    );
  }

  revalidatePath('/trips');
  redirect('/trips');
}
