'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { geocodeOnSegmentChange } from '@/lib/geocoding';
import { err, ok, type Result } from '@/types/result';

import * as repo from './repo';
import { flightLegsUpdateInput, segmentCreateInput } from './validators';
import type { Segment } from './repo';

// Same shape as trips/actions.ts so client form code (RHF setError
// adapter) can be reused without a translation layer.
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

// Revalidate every tab under the trip on segment mutations — counts,
// orderings, and the country filter bar all depend on segment state.
// Using the 'layout' modifier flushes the shared trip-detail layout
// (which renders the tab strip + country bar) along with all child
// pages.
function revalidateTrip(tripId: string) {
  revalidatePath(`/trips/${tripId}`, 'layout');
}

export async function createSegmentAction(
  tripId: string,
  raw: unknown,
): Promise<Result<{ id: string }, FormError>> {
  const user = await requireUser();
  const parsed = segmentCreateInput.safeParse(raw);
  if (!parsed.success) return err(flattenZod(parsed.error));

  try {
    const segment = await repo.create(user.id, tripId, parsed.data);
    geocodeOnSegmentChange({ segment });
    revalidateTrip(tripId);
    return ok({ id: segment.id });
  } catch (e) {
    if (e instanceof Error && e.message === 'TRIP_NOT_FOUND') {
      return err({ formMessage: 'Trip not found.' });
    }
    throw e;
  }
}

// Update an existing segment. Reuses `segmentCreateInput` for shape —
// the input is the same discriminated union as on create. Type
// changes are rejected here at the trust boundary: switching a flight
// segment to a hotel post-creation would require migrating the JSONB
// data shape and could orphan linked documents. The form locks the
// type when editing, but defence in depth.
export async function updateSegmentAction(
  tripId: string,
  segmentId: string,
  raw: unknown,
): Promise<Result<{ id: string }, FormError>> {
  const user = await requireUser();
  const parsed = segmentCreateInput.safeParse(raw);
  if (!parsed.success) return err(flattenZod(parsed.error));

  const existing = await repo.getByIdForUser(user.id, segmentId);
  if (!existing) return err({ formMessage: 'Segment not found.' });
  if (existing.type !== parsed.data.type) {
    return err({ formMessage: 'Segment type cannot be changed after creation.' });
  }

  const updated = await repo.update(user.id, segmentId, parsed.data);
  if (!updated) return err({ formMessage: 'Segment not found.' });

  geocodeOnSegmentChange({ segment: updated, prior: existing });

  revalidateTrip(tripId);
  return ok({ id: updated.id });
}

// Load the flight-leg sibling group for the multi-leg edit dialog.
// Siblings are flight segments sharing a linked document OR a
// non-empty PNR with the supplied segmentId; `self` is always
// included so the caller doesn't have to splice it in. Returns ok
// with a singleton `[self]` when no siblings exist — the client falls
// back to the single-segment SegmentForm in that case.
//
// Ownership: enforced via `getByIdForUser` and via the inner-trip
// JOIN in `listFlightLegGroup`. The supplied `tripId` is cross-checked
// against the segment's own tripId so a client supplying a mismatched
// pair gets a clean rejection instead of an opaque empty result.
export async function loadFlightLegGroupAction(
  tripId: string,
  segmentId: string,
): Promise<Result<Segment[], FormError>> {
  const user = await requireUser();

  const self = await repo.getByIdForUser(user.id, segmentId);
  if (!self) return err({ formMessage: 'Segment not found.' });
  if (self.tripId !== tripId) {
    return err({ formMessage: 'Segment does not belong to this trip.' });
  }
  if (self.type !== 'flight') {
    // Non-flight segments never multi-leg; return the singleton so
    // the dialog can render the standard SegmentForm.
    return ok([self]);
  }

  const group = await repo.listFlightLegGroup(user.id, segmentId);
  return ok(group.length > 0 ? group : [self]);
}

// Atomic multi-leg flight-segment update. The dialog gathers N edited
// legs and submits the full array; this action validates the batch,
// rejects any per-leg type drift (a non-flight slipping through the
// client form would be a programming error, but we surface it as a
// field error rather than a 500), and applies all updates inside a
// transaction so a partial failure rolls back.
//
// Field-error keys come back as `legs.${i}.input.…` — the dialog
// strips `legs.${i}.input.` and `legs.${i}.` prefixes per leg before
// passing keys to its tab's field components.
export async function updateFlightLegsAction(
  tripId: string,
  raw: unknown,
): Promise<Result<{ ids: string[] }, FormError>> {
  const user = await requireUser();

  const parsed = flightLegsUpdateInput.safeParse(raw);
  if (!parsed.success) return err(flattenZod(parsed.error));

  // Per-leg type guard. The discriminated `segmentCreateInput`
  // accepts every variant; this dialog only handles flights. Surface
  // the mismatch as a per-leg field error so the client can highlight
  // the offending tab.
  const typeErrors: Record<string, string> = {};
  for (const [i, leg] of parsed.data.legs.entries()) {
    if (leg.input.type !== 'flight') {
      typeErrors[`legs.${i}.input.type`] = 'Only flight segments can be batch-edited here.';
    }
  }
  if (Object.keys(typeErrors).length > 0) {
    return err({ fields: typeErrors, formMessage: 'Please fix the highlighted fields.' });
  }

  // Ownership + cross-trip + type drift pre-check. Parallelised
  // because each `getByIdForUser` is a single-row SELECT with no
  // side effects, and the user-scoped predicate inside `updateMany`
  // closes any TOCTOU window anyway — this pre-check is purely to
  // give friendly per-leg error messaging.
  const existingRows = await Promise.all(
    parsed.data.legs.map((leg) => repo.getByIdForUser(user.id, leg.id)),
  );
  for (const [i, existing] of existingRows.entries()) {
    if (!existing) return err({ formMessage: 'Segment not found.' });
    if (existing.tripId !== tripId) {
      return err({ formMessage: 'Segment does not belong to this trip.' });
    }
    if (existing.type !== parsed.data.legs[i]!.input.type) {
      return err({ formMessage: 'Segment type cannot be changed after creation.' });
    }
  }

  try {
    const rows = await repo.updateMany(user.id, parsed.data.legs);
    revalidateTrip(tripId);
    return ok({ ids: rows.map((r) => r.id) });
  } catch (e) {
    // updateMany throws SEGMENT_NOT_FOUND when its ownership-scoped
    // UPDATE returns zero rows mid-transaction. Translate to the same
    // generic message as the pre-check — the segment was removed
    // between our pre-check SELECTs and the transaction reaching it.
    if (e instanceof Error && e.message === 'SEGMENT_NOT_FOUND') {
      return err({ formMessage: 'Segment not found.' });
    }
    throw e;
  }
}

// Note on documents: link rows in `document_segments` cascade-delete
// when their segment is removed, so deleting a segment unlinks
// attached documents from the segment but **leaves them linked to
// the trip** (their `tripId` is always populated by the upload
// action). The document row, the file on disk, and the trip-level
// Documents tab presence all survive. Only when a document ends up
// with `tripId IS NULL` AND zero rows in `document_segments`
// (currently only via trip delete) does the orphan-sweep kick in
// via `orphanedAt`.
export async function deleteSegmentAction(
  tripId: string,
  id: string,
): Promise<Result<null, FormError>> {
  const user = await requireUser();
  const removed = await repo.hardDelete(user.id, id);
  if (!removed) return err({ formMessage: 'Segment not found.' });
  revalidateTrip(tripId);
  return ok(null);
}

// Promotion / demotion validators are intentionally small and inline:
// the inputs are a single date or nothing. No need to mint a separate
// schema module for this.
const scheduleInput = z
  .object({
    startsAt: z
      .union([z.string(), z.date()])
      .transform((v) => (v instanceof Date ? v : new Date(v)))
      .refine((d) => !Number.isNaN(d.getTime()), 'Pick a date'),
    endsAt: z
      .union([z.string(), z.date(), z.null()])
      .optional()
      .transform((v) => {
        if (v === null || v === undefined || v === '') return null;
        if (v instanceof Date) return v;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
      }),
  })
  .refine((v) => v.endsAt === null || v.endsAt >= v.startsAt, {
    path: ['endsAt'],
    message: 'End must be on or after start',
  });

export async function scheduleActivityAction(
  tripId: string,
  id: string,
  raw: unknown,
): Promise<Result<{ id: string }, FormError>> {
  const user = await requireUser();
  const parsed = scheduleInput.safeParse(raw);
  if (!parsed.success) return err(flattenZod(parsed.error));

  const segment = await repo.scheduleActivity(
    user.id,
    id,
    parsed.data.startsAt,
    parsed.data.endsAt,
  );
  if (!segment) return err({ formMessage: 'Activity not found.' });
  revalidateTrip(tripId);
  return ok({ id: segment.id });
}

export async function unscheduleActivityAction(
  tripId: string,
  id: string,
): Promise<Result<{ id: string }, FormError>> {
  const user = await requireUser();
  const segment = await repo.unscheduleActivity(user.id, id);
  if (!segment) return err({ formMessage: 'Activity not found.' });
  revalidateTrip(tripId);
  return ok({ id: segment.id });
}
