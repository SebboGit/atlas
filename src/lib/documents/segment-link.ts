// The "extract → segment" bridge (ADR-0008).
//
// Called from runExtractionJob after the parsed payload has been
// persisted on the document. Decides what segments should exist on
// the trip, dedupes against existing flight segments, creates them
// if needed, and links the document to each.
//
// Multi-flight documents (return trips, multi-leg connections) emit
// one segment per leg via `payloadToSegmentInputs`. Each leg runs
// the dedupe/create/link path independently and lands its own row
// in the `document_segments` join table.
//
// Pure-ish orchestration: every side-effect is delegated to repos,
// so failures are localised and the function is testable by mocking
// the repos at the module boundary.

import type { StructuredPayload } from '@/lib/extraction';
import { geocodeOnSegmentChange } from '@/lib/geocoding';
import { log } from '@/lib/log';
import { isWithinTripWindow } from '@/lib/segments/date-window';
import { payloadToSegmentInputs } from '@/lib/segments/from-payload';
import * as segmentsRepo from '@/lib/segments/repo';
import { type SegmentCreateInput, segmentCreateInput } from '@/lib/segments/validators';
import type { Trip } from '@/lib/trips/repo';
import * as tripsRepo from '@/lib/trips/repo';

import * as repo from './repo';

export interface EnsureSegmentArgs {
  userId: string;
  tripId: string;
  documentId: string;
  payload: StructuredPayload;
  /**
   * Segment IDs this document was linked to before `markExtractionStarted`
   * cleared the link rows. When a dedup match falls inside this set, the
   * segment is "owned" by this document — its extraction-derived fields
   * get overwritten with the new payload. Matches outside the set are
   * cross-document dedup (a different boarding pass for the same flight)
   * and are link-only. Empty on first extraction.
   */
  priorLinkedSegmentIds?: readonly string[];
  /**
   * Extraction claim captured by `markExtractionStarted`. The prior-link
   * update path gates its segment overwrite on (a) the document still
   * holding a cleared extraction flag (`extractionStartedAt = NULL` —
   * no fresh re-extract has stamped a new claim since `recordExtraction`)
   * and (b) the segment's `updatedAt` not having advanced past this stamp
   * (the user didn't save manual edits during the extraction window). See
   * {@link segmentsRepo.updateForActiveExtractionClaim}.
   */
  claim: { startedAt: Date };
}

/** Outcome for a single leg of a (possibly multi-flight) payload. */
export type PerLegOutcome =
  | { kind: 'linked-existing'; segmentId: string; dedup: true }
  | { kind: 'updated-prior'; segmentId: string; needsReview: boolean }
  | { kind: 'linked-new'; segmentId: string; needsReview: boolean }
  | { kind: 'create-failed' }
  | { kind: 'update-failed'; segmentId: string }
  | { kind: 'link-failed'; segmentId: string }
  /**
   * Prior-link update was skipped because a fresh re-extract has
   * superseded this job (the doc's `extractionStartedAt` was re-stamped
   * after our `recordExtraction` cleared it). The newer job will run
   * the bridge against its own payload; this leg is a no-op.
   */
  | { kind: 'superseded'; segmentId: string }
  /**
   * Prior-link update was skipped because the user edited the segment
   * during the extraction window — their value wins. We still link
   * the document to the segment so the doc appears under it.
   */
  | { kind: 'user-edited'; segmentId: string };

export type EnsureSegmentOutcome =
  | { kind: 'no-segment'; reason: 'generic' | 'unmappable' | 'doc-missing' | 'trip-missing' }
  | { kind: 'already-linked'; segmentIds: string[] }
  /**
   * One or more segments were processed. `items` carries the per-leg
   * outcome in input order; a single-flight document produces a
   * one-element array. Partial failures are tolerated — if leg 1
   * links and leg 2 hits `create-failed`, the user gets one segment
   * and a re-extract can fill in leg 2 (dedup catches the existing
   * one).
   */
  | { kind: 'linked'; items: PerLegOutcome[] };

/**
 * Make sure the document has a segment counterpart on the trip for
 * every flight in the payload, and is linked to each. Idempotent
 * against re-extract: if the document already has any segment link,
 * returns `already-linked` without touching anything. If the payload
 * doesn't map to any segments (generic, or missing required fields),
 * returns `no-segment` with the reason.
 *
 * Never throws — the caller treats this as best-effort. Extraction
 * has already succeeded by the time we're called; a failure here
 * leaves the row with `parsed` set but no segment link, which the
 * user can resolve by re-clicking Extract (the dedup lookup picks up
 * an orphaned segment if one was created on a prior failed link).
 */
export async function ensureSegmentForExtraction(
  args: EnsureSegmentArgs,
): Promise<EnsureSegmentOutcome> {
  const { userId, tripId, documentId, payload, claim } = args;
  const priorLinks = new Set(args.priorLinkedSegmentIds ?? []);

  const doc = await repo.getByIdForUser(userId, documentId);
  if (!doc) return { kind: 'no-segment', reason: 'doc-missing' };

  // Idempotency: once any EXTRACTION link exists, the bridge has
  // already run successfully for this document. Manual links (#103)
  // are excluded — they say nothing about whether the bridge ran, and
  // counting them would wrongly no-op a re-extract whose own links
  // were just wiped. (Rare consequence: re-extracting a doc the user
  // already hand-linked to a hand-made segment can create a second,
  // extraction-owned segment alongside it. Flights collapse via the
  // dedup key; for other types the user deletes the duplicate — the
  // alternative silently broke re-extract for every manually-linked
  // doc.) This branch presumes the caller has run
  // `markExtractionStarted` immediately before us, which wipes every
  // extraction-link row inside the same tx as the claim stamp. If
  // extraction links are still present, either:
  //   (a) the bridge ran twice on the same job (a bug — re-extract is
  //       single-shot), or
  //   (b) some path other than runExtractionJob is calling us.
  // Either way the safe move is to no-op rather than risk overwriting
  // segment fields that were settled by the earlier run. The bridge's
  // prior-link overwrite invariant relies on
  // `priorLinkedSegmentIds` being a SNAPSHOT taken at link-wipe time.
  const existingLinks = await repo.listLinkedSegmentIds(userId, documentId, {
    source: 'extraction',
  });
  if (existingLinks.length > 0) {
    return { kind: 'already-linked', segmentIds: existingLinks };
  }

  const inputs = payloadToSegmentInputs(payload);
  if (inputs.length === 0) {
    return {
      kind: 'no-segment',
      reason: payload.kind === 'generic' ? 'generic' : 'unmappable',
    };
  }

  // Trip re-read once for the whole payload — every leg's
  // needsReview is computed against the same trip window.
  const trip = await tripsRepo.getByIdForUser(userId, tripId);
  if (!trip) return { kind: 'no-segment', reason: 'trip-missing' };

  const items: PerLegOutcome[] = [];
  for (const input of inputs) {
    items.push(await processLeg({ userId, tripId, documentId, input, trip, priorLinks, claim }));
  }

  // Orphan sweep — close the gap between the re-extract UI banner
  // ("any segments auto-created from the previous run will be
  // replaced") and what the dedup-key-changed path actually did.
  // Before this loop the old segment was unlinked but never deleted,
  // so a re-extract that corrected the flight number left both the
  // old and new flights rendering on the trip. Now any segment in
  // `priorLinks` that the new run didn't reuse is hard-deleted —
  // UNLESS another document still links it. Our own extraction links
  // were wiped by `markExtractionStarted`, so any row remaining at
  // this point belongs to a different document or to a manual attach
  // (#103); a segment someone else still references is not an orphan,
  // and deleting it would cascade their link away. The reference
  // check folds into the DELETE (`hardDeleteIfUnreferenced`) so a
  // concurrent attach can't race a check-then-delete.
  //
  // Skip the sweep if any leg outcome reports `superseded` — that
  // marker means a newer claim has stamped the document mid-flight,
  // and the newer job is now responsible for its own orphan
  // accounting. We must not delete on its behalf.
  //
  // Each delete is best-effort: a failure logs and continues so a
  // single stuck row doesn't fail the whole extraction. The user
  // can clean up manually if needed.
  if (priorLinks.size > 0) {
    const supersededDetected = items.some((item) => item.kind === 'superseded');
    if (supersededDetected) {
      log.info({ documentId }, 'documents.segment_link.orphan_sweep_skipped_superseded');
    } else {
      const touchedIds = new Set<string>();
      for (const item of items) {
        if ('segmentId' in item) touchedIds.add(item.segmentId);
      }
      for (const priorId of priorLinks) {
        if (touchedIds.has(priorId)) continue;
        try {
          const removed = await segmentsRepo.hardDeleteIfUnreferenced(userId, priorId);
          if (removed) {
            log.info({ documentId, segmentId: priorId }, 'documents.segment_link.orphan_swept');
          } else {
            log.info({ documentId, segmentId: priorId }, 'documents.segment_link.orphan_kept');
          }
        } catch (e) {
          log.warn(
            {
              documentId,
              segmentId: priorId,
              err: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown',
            },
            'documents.segment_link.orphan_sweep_failed',
          );
        }
      }
    }
  }

  return { kind: 'linked', items };
}

interface ProcessLegArgs {
  userId: string;
  tripId: string;
  documentId: string;
  input: SegmentCreateInput;
  trip: Trip;
  priorLinks: ReadonlySet<string>;
  claim: { startedAt: Date };
}

/**
 * Process a single mapped leg, choosing one of three paths:
 *   1. **Prior-link update** — dedup matches a segment this document
 *      previously linked (re-extract): overwrite its extraction-derived
 *      fields with the new payload, then re-link.
 *   2. **Cross-doc dedup** — dedup matches a segment NOT in priorLinks
 *      (another boarding pass for the same flight): link only, leave
 *      fields alone.
 *   3. **Fresh create** — no dedup match: create the segment + link.
 *
 * Returns a `PerLegOutcome` describing what happened — never throws.
 * Errors from repo calls are logged and surfaced as `create-failed`
 * / `update-failed` / `link-failed`.
 */
async function processLeg({
  userId,
  tripId,
  documentId,
  input,
  trip,
  priorLinks,
  claim,
}: ProcessLegArgs): Promise<PerLegOutcome> {
  // Re-validate the mapper output against the same Zod schema that
  // gates the user-facing form (segmentCreateInput). Today the
  // mapper produces a shape that matches by construction, but a
  // future change to the mapper or the validator that drifts would
  // otherwise let bad data into segments.create/update. Fail loud
  // here — it's a code bug, not a user-facing one. Validating up
  // front (before the dedup branch) means the prior-link update path
  // gets the same gate as the fresh-create path.
  const validated = segmentCreateInput.safeParse(input);
  if (!validated.success) {
    log.warn(
      { documentId, issues: validated.error.issues.map((i) => i.path.join('.')) },
      'documents.segment_link.mapper_output_invalid',
    );
    return { kind: 'create-failed' };
  }

  const needsReview = !isWithinTripWindow(input.startsAt, trip);

  // Boarding-pass dedup: collapse "same flight for different
  // travellers" into one segment. Requires all three components —
  // partial keys would risk merging unrelated flights together.
  let existing: Awaited<ReturnType<typeof segmentsRepo.findFlightByKey>> = null;
  if (
    input.type === 'flight' &&
    typeof input.data.carrier === 'string' &&
    typeof input.data.flightNumber === 'string' &&
    input.startsAt
  ) {
    existing = await segmentsRepo.findFlightByKey(userId, tripId, {
      carrier: input.data.carrier,
      flightNumber: input.data.flightNumber,
      flightDate: input.startsAt,
    });
  }

  if (existing) {
    // Prior-link match → this document owned the segment before
    // re-extract wiped the link. Overwrite the extraction-derived
    // fields with the new payload so a bug-fix re-extract actually
    // changes what the user sees. Cross-doc matches (segment not in
    // priorLinks) fall through to link-only — overwriting them would
    // clobber another document's view.
    if (priorLinks.has(existing.id)) {
      let result;
      try {
        result = await segmentsRepo.updateForActiveExtractionClaim(
          userId,
          existing.id,
          validated.data,
          { needsReview },
          { documentId, startedAt: claim.startedAt },
        );
      } catch (e) {
        log.warn(
          {
            documentId,
            segmentId: existing.id,
            err: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown',
          },
          'documents.segment_link.update_failed',
        );
        return { kind: 'update-failed', segmentId: existing.id };
      }

      if (result.outcome === 'superseded') {
        // A fresh re-extract stamped a new claim between our
        // recordExtraction and now. The newer job owns the row;
        // skip the overwrite and the link — the new job will write
        // its own link to whatever segment it dedups to.
        log.info(
          { documentId, segmentId: existing.id },
          'documents.segment_link.update_superseded',
        );
        return { kind: 'superseded', segmentId: existing.id };
      }
      if (result.outcome === 'not-found') {
        // Race: segment vanished between dedup and update. The
        // segment we matched no longer exists; nothing safe to link.
        log.warn(
          { documentId, segmentId: existing.id },
          'documents.segment_link.update_target_missing',
        );
        return { kind: 'update-failed', segmentId: existing.id };
      }
      if (result.outcome === 'user-edited') {
        // User saved manual edits on this segment during the
        // extraction window. Their value beats the LLM's — link
        // the doc so the original is reachable from the segment,
        // but leave fields alone.
        log.info(
          { documentId, segmentId: existing.id },
          'documents.segment_link.update_skipped_user_edited',
        );
        const linked = await repo.linkSegment(userId, documentId, existing.id);
        if (!linked) {
          log.warn(
            { documentId, segmentId: existing.id },
            'documents.segment_link.link_failed_user_edited',
          );
          return { kind: 'link-failed', segmentId: existing.id };
        }
        return { kind: 'user-edited', segmentId: existing.id };
      }

      const updated = result.segment;
      const linked = await repo.linkSegment(userId, documentId, existing.id);
      if (!linked) {
        log.warn(
          { documentId, segmentId: existing.id },
          'documents.segment_link.link_failed_updated',
        );
        return { kind: 'link-failed', segmentId: existing.id };
      }
      // Re-extract may have changed an address (hotel) or a name —
      // the lifecycle hook compares derived queries and no-ops when
      // nothing geocodable shifted. Flights short-circuit inside
      // buildGeocodeQuery.
      geocodeOnSegmentChange({ segment: updated, prior: existing });
      return { kind: 'updated-prior', segmentId: existing.id, needsReview };
    }

    const linked = await repo.linkSegment(userId, documentId, existing.id);
    if (!linked) {
      log.warn(
        { documentId, segmentId: existing.id },
        'documents.segment_link.link_failed_existing',
      );
      return { kind: 'link-failed', segmentId: existing.id };
    }
    return { kind: 'linked-existing', segmentId: existing.id, dedup: true };
  }

  let created;
  try {
    created = await segmentsRepo.create(userId, tripId, validated.data, { needsReview });
  } catch (e) {
    log.warn(
      {
        documentId,
        err: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown',
      },
      'documents.segment_link.create_failed',
    );
    return { kind: 'create-failed' };
  }

  const linked = await repo.linkSegment(userId, documentId, created.id);
  if (!linked) {
    // We just created this segment, and now nothing references it —
    // either a concurrent re-extract re-marked the doc (linkSegment's
    // claim guard) or some other writer landed first. Either way the
    // segment is genuinely orphaned and would clutter the trip. Best-
    // effort delete; if it fails, the user can clean up manually.
    log.warn({ documentId, segmentId: created.id }, 'documents.segment_link.link_failed_new');
    await segmentsRepo.hardDelete(userId, created.id).catch((e) =>
      log.warn(
        {
          segmentId: created.id,
          err: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown',
        },
        'documents.segment_link.orphan_cleanup_failed',
      ),
    );
    return { kind: 'link-failed', segmentId: created.id };
  }
  // Extraction-created hotels carry a propertyName + address straight
  // from the payload mapper, so the geocode hook fires here without
  // waiting for the user to open the segment edit dialog. Flights
  // short-circuit inside buildGeocodeQuery.
  geocodeOnSegmentChange({ segment: created });
  return { kind: 'linked-new', segmentId: created.id, needsReview };
}
