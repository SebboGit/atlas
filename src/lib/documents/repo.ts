import { and, asc, desc, eq, getTableColumns, isNull, lt, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { documentSegments, documents, segments, trips, type Document } from '@/db/schema';

// Re-exported so the feature barrel surfaces the type without
// reaching into @/db/*. Type-only — erased at compile time.
export type { Document };

// Document row plus the number of segments it currently links to.
// `linkedSegmentCount` is cheaper than fetching the IDs and the list
// UI only needs the boolean "is it linked?"; callers that need the
// IDs themselves use {@link listLinkedSegmentIds}.
export type DocumentWithLinks = Document & { linkedSegmentCount: number };

const docCols = getTableColumns(documents);

// Subquery exposing the link count as a correlated scalar so it can
// be selected alongside the regular document columns without a GROUP
// BY (which would need every Document column to be aggregated).
const linkedSegmentCountSql = sql<number>`(
  SELECT count(*)::int
  FROM ${documentSegments}
  WHERE ${documentSegments.documentId} = ${documents.id}
)`;

// All docs attached to a trip, whether linked to a segment or not.
// Each row carries `linkedSegmentCount` so the UI can render a
// "linked" indicator without a second round-trip. Scoped by inner join
// on trips.userId so this can't return another user's row even if a bad
// tripId is supplied.
//
// ADR-0015: documents stay uploader-scoped, NOT trip-visibility-scoped —
// a household member sees a shared trip's segments but not its uploaded
// files. The trips.userId join is equivalent to documents.userId TODAY
// only because upload is owner-only (every attached doc's userId equals
// its trip's userId). If household document uploads ever ship, switch
// this (and countForTrip) to eq(documents.userId, userId) so a
// co-uploader's files don't leak to the trip owner.
export async function listForTrip(userId: string, tripId: string): Promise<DocumentWithLinks[]> {
  return db
    .select({ ...docCols, linkedSegmentCount: linkedSegmentCountSql })
    .from(documents)
    .innerJoin(trips, eq(documents.tripId, trips.id))
    .where(and(eq(documents.tripId, tripId), eq(trips.userId, userId)))
    .orderBy(desc(documents.createdAt));
}

// Count of docs attached to a trip — same ownership constraint as
// listForTrip. Used by the delete-trip dialog so the user knows how
// many files are on the line before confirming.
export async function countForTrip(userId: string, tripId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .innerJoin(trips, eq(documents.tripId, trips.id))
    .where(and(eq(documents.tripId, tripId), eq(trips.userId, userId)));
  return row?.n ?? 0;
}

export async function getByIdForUser(userId: string, id: string): Promise<Document | null> {
  const rows = await db
    .select(docCols)
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface CreateDocumentInput {
  tripId?: string | null;
  objectKey: string;
  mime: string;
  bytes: number;
  sha256: string;
  originalName: string;
}

// Inserts a document row, idempotent on `(userId, sha256)` — uploading
// the same content twice returns the existing row (see CLAUDE.md
// invariant #4). The caller is responsible for cleaning up the just-
// written storage file when `isNew === false`, since the orphan would
// otherwise sit on disk until the periodic sweep.
//
// We use INSERT … ON CONFLICT DO NOTHING RETURNING instead of a
// SELECT-then-INSERT pre-check: two concurrent uploads of identical
// content from the same user would both miss a pre-check and both
// attempt to insert; the loser would throw a unique-violation while
// having already written its file to disk (an orphan). With ON
// CONFLICT, the loser simply gets an empty RETURNING and falls back
// to fetching the winner's row — no thrown error, action layer
// cleans up the orphan file.
export async function create(
  userId: string,
  input: CreateDocumentInput,
): Promise<{ document: Document; isNew: boolean }> {
  const [inserted] = await db
    .insert(documents)
    .values({
      userId,
      tripId: input.tripId ?? null,
      objectKey: input.objectKey,
      mime: input.mime,
      bytes: input.bytes,
      sha256: input.sha256,
      originalName: input.originalName,
    })
    .onConflictDoNothing({ target: [documents.userId, documents.sha256] })
    .returning();
  if (inserted) return { document: inserted, isNew: true };

  // Conflict — same (userId, sha256) already exists. Fetch it.
  const [existing] = await db
    .select(docCols)
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.sha256, input.sha256)))
    .limit(1);
  if (!existing) {
    // Theoretically unreachable: the conflict target matches a unique
    // index, so a conflict implies a row exists. If we get here,
    // something else has happened (concurrent delete) — surface it so
    // the caller doesn't pretend success.
    throw new Error('Document conflict but no existing row');
  }
  return { document: existing, isNew: false };
}

export type ParsedBy =
  | 'pdf-text'
  | 'ocr-tesseract'
  | 'ocr-paddle'
  | 'llm-haiku'
  | 'llm-local'
  | 'pkpass'
  | 'manual';

export type TextMethod = 'pdf-text' | 'ocr-tesseract' | 'email';

export type ExtractionFailureReason =
  | 'pdf-empty'
  | 'ocr-empty'
  | 'llm-unavailable'
  | 'llm-invalid-json'
  | 'all-extractors-failed';

export interface ExtractionRecord {
  parsed: unknown | null;
  parsedBy: ParsedBy | null;
  parsedConfidence: number | null;
  /**
   * Text-extraction stage that fed the LLM. NULL for direct extractors
   * (pkpass) where no LLM was called, and for failures.
   */
  textMethod: TextMethod | null;
  extractionError: ExtractionFailureReason | null;
}

// Persist the orchestrator's result on the document row. On success
// `parsed` carries the structured payload and `extractionError` is
// cleared; on failure `parsed`/`parsedBy`/`parsedConfidence` are
// nulled out and `extractionError` records the reason. Returns the
// updated row scoped to the user, or null if no such doc exists for
// this user.
// Predicate-update keyed on the claim timestamp the job captured at
// mark-time. If the row's current `extractionStartedAt` no longer
// matches, this job was superseded by a re-click (or the row was
// deleted) — we return null and the caller skips. This is the
// concurrency guarantee that prevents a slow stale job from clobbering
// a fresh job's claim (last-write-wins on the same row is otherwise
// the default).
export async function recordExtraction(
  userId: string,
  id: string,
  record: ExtractionRecord,
  claim: Date,
): Promise<Document | null> {
  const rows = await db
    .update(documents)
    .set({
      parsed: record.parsed,
      parsedBy: record.parsedBy,
      parsedConfidence: record.parsedConfidence,
      textMethod: record.textMethod,
      extractionError: record.extractionError,
      // The job is finished — release the in-progress flag in the same
      // write so the UI can never see "extracting AND has a result"
      // simultaneously.
      extractionStartedAt: null,
    })
    .where(
      and(
        eq(documents.id, id),
        eq(documents.userId, userId),
        eq(documents.extractionStartedAt, claim),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Result of {@link markExtractionStarted}. The `document` row is the
 * freshly-stamped state; `priorLinkedSegmentIds` carries the segment
 * IDs this document was linked to BEFORE we cleared those links. The
 * extraction-bridge (`ensureSegmentForExtraction`) uses the prior set
 * to distinguish "this document owned that segment" (update in place)
 * from "another document also dedup-matches that segment" (link only,
 * leave fields alone).
 */
export interface MarkExtractionStartedResult {
  document: Document;
  priorLinkedSegmentIds: string[];
}

// Stamp `extractionStartedAt = NOW()` for a doc the user owns, clearing
// any previous parsed payload, error state, AND all extraction-created
// segment links. Clearing links here means re-extract is one button: a
// fresh extraction starts from a clean slate, and the segment-link
// bridge runs again (dedup will collapse back to existing segments if
// the extracted (carrier, flightNumber, flightDate) still match). The
// returned `priorLinkedSegmentIds` lets the bridge tell its own prior
// segments (overwrite in place) from cross-document dedup matches
// (link only, leave fields alone).
//
// Manual links (`source = 'manual'`, the #103 attach flow) are NOT
// wiped and NOT snapshotted: the re-extract lifecycle neither owns
// their rows nor the segments behind them, so a re-extract can never
// overwrite or orphan-sweep a segment the user linked by hand.
//
// The SELECT, UPDATE, and link DELETE run inside a single transaction
// so (a) the UI never sees the half-state "extracting AND still linked
// to stale segments" and (b) a concurrent linker can't slip a row
// past the snapshot we hand the caller. The caller MUST use the
// returned `document.extractionStartedAt` as a claim token on the
// matching `recordExtraction` / `clearExtractionStarted` call so a
// slow superseded job can't clobber the current claim.
export async function markExtractionStarted(
  userId: string,
  id: string,
): Promise<MarkExtractionStartedResult | null> {
  return db.transaction(async (tx) => {
    // Capture the prior link set first. Scoped via the documents row
    // so we only ever surface segment IDs owned by this user — the
    // join here mirrors the safety pattern the DELETE below relies on.
    const linkRows = await tx
      .select({ segmentId: documentSegments.segmentId })
      .from(documentSegments)
      .innerJoin(documents, eq(documents.id, documentSegments.documentId))
      .where(
        and(
          eq(documents.id, id),
          eq(documents.userId, userId),
          eq(documentSegments.source, 'extraction'),
        ),
      );

    const rows = await tx
      .update(documents)
      .set({
        extractionStartedAt: new Date(),
        parsed: null,
        parsedBy: null,
        parsedConfidence: null,
        textMethod: null,
        extractionError: null,
      })
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning();
    if (rows.length === 0) return null;
    // Belt-and-braces: even though the UPDATE above already proved
    // ownership (and we only reach here if that UPDATE matched a
    // row), scope the link DELETE via the documents row's userId
    // too. Keeps the safety property local to this statement so a
    // future refactor that splits the tx or reorders the writes
    // can't silently widen the blast radius.
    await tx
      .delete(documentSegments)
      .where(
        and(
          eq(documentSegments.documentId, id),
          eq(documentSegments.source, 'extraction'),
          sql`EXISTS (SELECT 1 FROM ${documents} WHERE ${documents.id} = ${documentSegments.documentId} AND ${documents.userId} = ${userId})`,
        ),
      );
    return {
      document: rows[0]!,
      priorLinkedSegmentIds: linkRows.map((r) => r.segmentId),
    };
  });
}

// Clear `extractionStartedAt` ONLY if it still equals the claim we
// captured at mark-time. A superseded job (the user re-clicked and a
// fresh `markExtractionStarted` has since landed) must not clear the
// new job's flag. Returns true if our claim was honoured.
export async function clearExtractionStarted(
  userId: string,
  id: string,
  claim: Date,
): Promise<boolean> {
  const rows = await db
    .update(documents)
    .set({ extractionStartedAt: null })
    .where(
      and(
        eq(documents.id, id),
        eq(documents.userId, userId),
        eq(documents.extractionStartedAt, claim),
      ),
    )
    .returning({ id: documents.id });
  return rows.length > 0;
}

// Forcibly clear `extractionStartedAt` for any row whose claim is older
// than `maxAgeMs`. Used as a reactive sweep at the start of a fresh
// extract — picks up rows left dangling by a Node crash mid-job. The
// stamp is forced to NULL only; we don't touch parsed/error so a
// row that was both "stale extracting" AND "previously failed" still
// surfaces as failed. Returns the number of rows reset.
export async function resetStaleExtractions(userId: string, maxAgeMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const rows = await db
    .update(documents)
    .set({ extractionStartedAt: null })
    .where(and(eq(documents.userId, userId), lt(documents.extractionStartedAt, cutoff)))
    .returning({ id: documents.id });
  return rows.length;
}

// Replace the document's `parsed` JSONB with user-edited values
// (see updateParsedAction). Refuses to overwrite while extraction
// is in flight: the predicate `extractionStartedAt IS NULL` blocks
// the dialog's "old payload" Save from landing on top of a freshly-
// extracting row whose `parsed` has just been nulled by
// `markExtractionStarted`. Returns null in that case; the caller
// surfaces a "Document is being re-extracted" error.
//
// We don't touch parsedBy / parsedConfidence / textMethod here —
// those track HOW the data was produced (LLM, OCR, pkpass) and
// stay accurate for the audit story even after a manual edit.
export async function updateParsed(
  userId: string,
  id: string,
  parsed: unknown,
): Promise<Document | null> {
  const rows = await db
    .update(documents)
    .set({ parsed })
    .where(
      and(
        eq(documents.id, id),
        eq(documents.userId, userId),
        isNull(documents.extractionStartedAt),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

// Set or clear the user-facing display title. `null` reverts display
// to `originalName`. Unlike `updateParsed` this deliberately ignores
// any in-flight extraction — the title is pure display metadata,
// disjoint from everything the extraction pipeline writes.
export async function rename(
  userId: string,
  id: string,
  title: string | null,
): Promise<Document | null> {
  const rows = await db
    .update(documents)
    .set({ title })
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

// Insert a (document, segment) row into the join table, scoped to
// the user. Used by the ADR-0008 auto-create flow after a segment
// has been created (or matched via dedup) from an extracted payload.
// Two guards beyond ownership:
//   - `extractionStartedAt IS NULL`: if a fresh re-extract has marked
//     the row between this job's recordExtraction and its segment-
//     link step, the stale job's payload no longer matches what's on
//     the row — refuse to link. The new job's segment-link runs
//     against the fresh payload. Without this guard a re-extract
//     race produces "doc.parsed=Y, doc points at a segment built
//     from stale X."
//   - Segment ownership: the segment must belong to the same user
//     (via its trip). Today every caller derives `segmentId` from a
//     user-scoped repo call, so this is defense-in-depth — but it
//     turns "the caller is trusted not to pass a foreign id" into
//     a structural guarantee enforced at the same trust boundary as
//     the document check.
//
// Duplicate (documentId, segmentId) pairs are silently ignored via
// the composite-PK ON CONFLICT — re-running the bridge against the
// same dedup match is idempotent. The transaction takes a row lock
// (`SELECT … FOR UPDATE`) so a concurrent `markExtractionStarted`
// either lands before us (we'll see the new `extractionStartedAt`
// and bow out) or blocks until we commit.
//
// Returns true if the link landed (or was already present and our
// freshness check passed).
export async function linkSegment(userId: string, id: string, segmentId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .select({ extractionStartedAt: documents.extractionStartedAt })
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .for('update');
    if (!doc) return false;
    if (doc.extractionStartedAt !== null) return false;

    // Ownership probe: the segment must live under a trip owned by
    // the same user. Inner join via trips because `segments` has no
    // `userId` column of its own. Cheap (PK + FK lookups) and runs
    // inside the same tx that already holds the document lock.
    const [owned] = await tx
      .select({ id: segments.id })
      .from(segments)
      .innerJoin(trips, eq(segments.tripId, trips.id))
      .where(and(eq(segments.id, segmentId), eq(trips.userId, userId)))
      .limit(1);
    if (!owned) return false;

    // ON CONFLICT deliberately leaves an existing MANUAL row as-is
    // rather than re-badging it to 'extraction': if the user attached
    // this pair by hand while the extraction job was in flight, their
    // association wins and the segment stays out of the re-extract
    // blast radius. The cost is the documented duplicate-segment edge
    // on that document's next re-extract — safer than silently pulling
    // a hand-linked segment into overwrite/sweep scope.
    await tx
      .insert(documentSegments)
      .values({ documentId: id, segmentId, source: 'extraction' })
      .onConflictDoNothing();
    return true;
  });
}

// Lightweight view of a document used by segment cards to render
// "open the original" chips. Carries only the fields the UI needs —
// the full Document row would pull JSONB `parsed`, raw bytes, and
// extraction bookkeeping that the chip never reads.
export interface LinkedDocument {
  id: string;
  originalName: string;
  title: string | null;
  mime: string;
}

// One join across (trip → segment → document_segments → document)
// returns every linked doc for every segment on the trip, grouped by
// segmentId. Ownership is enforced through `trips.userId`; only docs
// reachable via a segment on a trip the user owns are returned. The
// segment-side index (`document_segments_segment_idx`) supports the
// join's segmentId predicates, and the doc-side PK satisfies the
// other half.
//
// Returns a Map so call sites can do `map.get(segmentId) ?? []`
// without a second pass. Segments with no linked docs simply don't
// appear in the map — the missing-key case is the empty-list case.
// Order is `documents.createdAt asc` so the oldest pass renders
// first when a flight has multiple boarding passes attached (one
// per traveller); this keeps chip order stable across page loads.
export async function listLinkedDocumentsByTripSegment(
  userId: string,
  tripId: string,
): Promise<Map<string, LinkedDocument[]>> {
  const rows = await db
    .select({
      segmentId: documentSegments.segmentId,
      id: documents.id,
      originalName: documents.originalName,
      title: documents.title,
      mime: documents.mime,
    })
    .from(documentSegments)
    .innerJoin(documents, eq(documentSegments.documentId, documents.id))
    .innerJoin(segments, eq(documentSegments.segmentId, segments.id))
    .innerJoin(trips, eq(segments.tripId, trips.id))
    .where(and(eq(segments.tripId, tripId), eq(trips.userId, userId)))
    .orderBy(asc(documents.createdAt));

  const map = new Map<string, LinkedDocument[]>();
  for (const row of rows) {
    const { segmentId, ...doc } = row;
    const list = map.get(segmentId);
    if (list) list.push(doc);
    else map.set(segmentId, [doc]);
  }
  return map;
}

// Read the segment IDs currently linked to a document. Used by the
// segment-link bridge for its idempotency short-circuit and by any UI
// that needs the full list rather than just a count. The bridge passes
// `source: 'extraction'` — manual links say nothing about whether the
// bridge already ran, so counting them would wrongly no-op a re-extract
// whose own links were just wiped by `markExtractionStarted`.
export async function listLinkedSegmentIds(
  userId: string,
  documentId: string,
  opts?: { source?: 'extraction' | 'manual' },
): Promise<string[]> {
  const rows = await db
    .select({ segmentId: documentSegments.segmentId })
    .from(documentSegments)
    .innerJoin(documents, eq(documentSegments.documentId, documents.id))
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.userId, userId),
        opts?.source ? eq(documentSegments.source, opts.source) : undefined,
      ),
    );
  return rows.map((r) => r.segmentId);
}

// One row per document on the trip, flagged with whether it is
// currently linked to the given segment. Backs the info-dialog's
// attach/detach toggle list (#103): the user sees every candidate,
// including docs already linked elsewhere (one confirmation can back
// several segments). Ordered newest-first to match the Documents tab.
export interface SegmentLinkOption {
  id: string;
  originalName: string;
  title: string | null;
  mime: string;
  linked: boolean;
}

export async function listSegmentLinkOptions(
  userId: string,
  tripId: string,
  segmentId: string,
): Promise<SegmentLinkOption[]> {
  const rows = await db
    .select({
      id: documents.id,
      originalName: documents.originalName,
      title: documents.title,
      mime: documents.mime,
      linked: sql<boolean>`EXISTS (SELECT 1 FROM ${documentSegments} WHERE ${documentSegments.documentId} = ${documents.id} AND ${documentSegments.segmentId} = ${segmentId})`,
    })
    .from(documents)
    .where(and(eq(documents.tripId, tripId), eq(documents.userId, userId)))
    .orderBy(desc(documents.createdAt));
  return rows;
}

// Attach or detach a document ↔ segment link on the user's behalf.
// Attach writes `source = 'manual'`; if an extraction-created row for
// the pair already exists it is kept as-is (ON CONFLICT DO NOTHING),
// so toggling an already-extraction-linked doc never re-badges the row
// and never moves it out of the re-extract lifecycle. Detach removes
// the row regardless of source — the user's explicit unlink wins, and
// a subsequent re-extract simply no longer sees that segment as prior-
// linked. Both directions verify the segment lives under a trip the
// user owns and the document belongs to the user AND the same trip.
// Returns false when any ownership probe fails.
export async function setManualLink(
  userId: string,
  documentId: string,
  segmentId: string,
  linked: boolean,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .select({ tripId: documents.tripId })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
    if (!doc || doc.tripId === null) return false;

    const [seg] = await tx
      .select({ tripId: segments.tripId })
      .from(segments)
      .innerJoin(trips, eq(segments.tripId, trips.id))
      .where(and(eq(segments.id, segmentId), eq(trips.userId, userId)))
      .limit(1);
    if (!seg || seg.tripId !== doc.tripId) return false;

    if (linked) {
      await tx
        .insert(documentSegments)
        .values({ documentId, segmentId, source: 'manual' })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(documentSegments)
        .where(
          and(
            eq(documentSegments.documentId, documentId),
            eq(documentSegments.segmentId, segmentId),
          ),
        );
    }
    return true;
  });
}

// Hard delete the row and return it so the caller can clean up the
// file on disk. Caller MUST delete storage by `row.objectKey` after a
// successful return — the row is the only reference to the file
// lifetime.
export async function hardDelete(userId: string, id: string): Promise<Document | null> {
  const rows = await db
    .delete(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .returning();
  return rows[0] ?? null;
}
