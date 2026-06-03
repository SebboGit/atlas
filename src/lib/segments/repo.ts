import { and, asc, eq, getTableColumns, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db/client';
import { documentSegments, documents, segments, trips, type Segment } from '@/db/schema';
import { equivalentCarrierForms } from '@/lib/airlines';

import type { SegmentCreateInput, SegmentListFilters } from './validators';

// Re-exported so the feature barrel can surface it without reaching into
// @/db/* itself. Type-only — erased at compile time, no runtime cost.
export type { Segment };

// Projects only segment columns even though we join through trips for
// ownership. Without this, Drizzle returns a `{ segments, trips }`
// nested shape which the call sites don't want.
const segmentCols = getTableColumns(segments);

// Hard cap — the personal-app assumption. When we routinely exceed this
// per trip, switch to a (startsAt, id) cursor.
const LIST_LIMIT = 500 as const;

export async function listForTrip(
  userId: string,
  tripId: string,
  filters: SegmentListFilters = {},
): Promise<Segment[]> {
  const conditions = [eq(segments.tripId, tripId), eq(trips.userId, userId)];

  if (filters.type) conditions.push(eq(segments.type, filters.type));
  if (filters.countryCode) {
    // ADR-0005: country filter matches either end of a flight. For
    // non-flight types, originCountryCode is NULL so the second clause
    // is a no-op against the same column-pair index.
    const cc = filters.countryCode;
    const clause = or(eq(segments.countryCode, cc), eq(segments.originCountryCode, cc));
    if (clause) conditions.push(clause);
  }
  if (filters.scheduled === true) conditions.push(isNotNull(segments.startsAt));
  if (filters.scheduled === false) conditions.push(isNull(segments.startsAt));

  return db
    .select(segmentCols)
    .from(segments)
    .innerJoin(trips, eq(segments.tripId, trips.id))
    .where(and(...conditions))
    .orderBy(
      // Chronological with undated rows sinking to the end. Scheduled-only
      // callers pre-filter NULLs out, so this only matters when both
      // states are mixed (e.g. the Activities tab's combined query).
      sql`${segments.startsAt} asc nulls last`,
      asc(segments.createdAt),
    )
    .limit(LIST_LIMIT);
}

export async function getByIdForUser(userId: string, id: string): Promise<Segment | null> {
  const rows = await db
    .select(segmentCols)
    .from(segments)
    .innerJoin(trips, eq(segments.tripId, trips.id))
    .where(and(eq(segments.id, id), eq(trips.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

// Returns the distinct ISO-2 country codes referenced by any segment of
// this trip, across both primary and origin columns. Used by the
// trip-detail layout to decide whether to render the country filter bar
// (only when ≥ 2 distinct countries are present; see ADR-0004).
//
// Cardinality here is tiny (segments per trip, two columns each), so
// we fetch the two columns and dedupe in JS rather than building a
// raw-SQL UNION. The query hits the (trip_id, ...) index either way.
// React.cache: the trip layout and the itinerary/map tab pages all request
// the trip's country codes in the same render pass — dedupe to one query.
export const listCountryCodesForTrip = cache(
  async (userId: string, tripId: string): Promise<string[]> => {
    const rows = await db
      .select({
        countryCode: segments.countryCode,
        originCountryCode: segments.originCountryCode,
      })
      .from(segments)
      .innerJoin(trips, eq(segments.tripId, trips.id))
      .where(and(eq(segments.tripId, tripId), eq(trips.userId, userId)));

    const codes = new Set<string>();
    for (const row of rows) {
      if (row.countryCode) codes.add(row.countryCode);
      if (row.originCountryCode) codes.add(row.originCountryCode);
    }
    return Array.from(codes).sort();
  },
);

export interface CreateOptions {
  /**
   * ADR-0008 advisory: set when the segment's `startsAt` falls outside
   * the trip's ±2 day window. The UI renders an advisory chip on the
   * segment card. Both the document-extraction pipeline and the manual
   * create/edit actions compute it against the trip window, so the chip
   * reflects the segment's current date regardless of how it was
   * entered. Defaults to `false` when the caller omits it.
   */
  needsReview?: boolean;
}

// Verifies the trip belongs to the user, then writes the segment row.
// Throws on missing trip — the action layer translates that into a
// user-facing Result.
export async function create(
  userId: string,
  tripId: string,
  input: SegmentCreateInput,
  opts: CreateOptions = {},
): Promise<Segment> {
  const [owned] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
    .limit(1);
  if (!owned) throw new Error('TRIP_NOT_FOUND');

  // Geography is per-variant in the validator (validators.ts):
  //   - flight: locationName, countryCode, originCountryCode
  //   - hotel/activity/transit: locationName, countryCode
  //   - note: none
  // Read defensively here so the repo doesn't have to mirror the union
  // discriminator; the per-variant Zod parse has already stripped
  // fields that don't belong, but explicit `in` checks keep TS happy
  // and document the column-write contract.
  const locationName = 'locationName' in input ? (input.locationName ?? null) : null;
  const countryCode = 'countryCode' in input ? (input.countryCode ?? null) : null;
  const originCountryCode = input.type === 'flight' ? (input.originCountryCode ?? null) : null;

  const [row] = await db
    .insert(segments)
    .values({
      tripId,
      type: input.type,
      data: input.data,
      startsAt: input.startsAt,
      // Food is point-in-time — a reservation time, no end. Drop any
      // endsAt (e.g. one left in form state by a hotel→food type
      // switch) so it never lands on a food row.
      endsAt: input.type === 'food' ? null : input.endsAt,
      locationName,
      countryCode,
      originCountryCode,
      needsReview: opts.needsReview ?? false,
    })
    .returning();
  if (!row) throw new Error('Segment insert returned no row');
  return row;
}

// Lookup a flight segment on the trip whose stored `data` JSONB has
// matching carrier + flightNumber + flightDate. Used by the document-
// extraction pipeline (ADR-0008) to dedupe boarding passes for the
// same flight across multiple travellers — many docs → one segment.
//
// Match is conservative: the caller MUST supply all three components
// (we don't dedupe on partial keys; better to create a stub the user
// can clean up than to merge two unrelated flights).
//
// **Carrier** is expanded to its equivalent forms via
// `equivalentCarrierForms` (ADR-0009) — a query for "British Airways"
// matches both name-form and IATA-form storage in either direction.
// This is the carrier-side compensation for storage drift between
// pre- and post-ADR-0009 segments. The caller still trims/normalises
// whatever they pass; this just handles the name↔code equivalence.
//
// **flightDate** is compared as an exact-instant equality on
// `starts_at`. This is the *existing* behaviour and it works when
// both sides came from the same code path (form picker → local
// midnight, or LLM-only `flightDate` → local midnight). It silently
// misses when one side is a real ISO instant from
// `scheduledDeparture` (e.g. "2026-06-01T11:30:00Z") and the other
// is local midnight — the two represent the same wall-clock day but
// different absolute instants. The clean fix is a global "store
// dates as wall-clock day, not timestamptz" change, out of scope
// for ADR-0009. In practice "same flight, two travellers" usually
// means "same extraction path on both docs", so the miss is rare.
// flightNumber is still exact-string; case normalisation is the
// caller's job.
export async function findFlightByKey(
  userId: string,
  tripId: string,
  key: { carrier: string; flightNumber: string; flightDate: Date },
): Promise<Segment | null> {
  const carrierCandidates = equivalentCarrierForms(key.carrier);
  // Defensive — equivalentCarrierForms returns [] only for empty input,
  // and the caller's guard upstream already rejects that. If we ever
  // get here with no candidates, fall back to the literal value rather
  // than running an `IN ()` that postgres rejects.
  const carrierMatch =
    carrierCandidates.length > 0
      ? inArray(sql`${segments.data}->>'carrier'`, carrierCandidates)
      : eq(sql`${segments.data}->>'carrier'`, key.carrier);

  const rows = await db
    .select(segmentCols)
    .from(segments)
    .innerJoin(trips, eq(segments.tripId, trips.id))
    .where(
      and(
        eq(segments.tripId, tripId),
        eq(trips.userId, userId),
        eq(segments.type, 'flight'),
        carrierMatch,
        eq(sql`${segments.data}->>'flightNumber'`, key.flightNumber),
        eq(segments.startsAt, key.flightDate),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// Set-payload extraction shared by `update` and `updateMany`. The
// discriminated-input has already had per-variant fields stripped by
// the validator, but the column writes still need defensive
// per-variant reads to keep TS narrowing happy and to avoid leaking
// (say) an originCountryCode onto a hotel row if the union shape ever
// gets a column-write seam wrong elsewhere.
function setColumnsFromInput(input: SegmentCreateInput, needsReview: boolean) {
  return {
    type: input.type,
    data: input.data,
    startsAt: input.startsAt,
    // Food is point-in-time — see create(); never persist an endsAt.
    endsAt: input.type === 'food' ? null : input.endsAt,
    locationName: 'locationName' in input ? (input.locationName ?? null) : null,
    countryCode: 'countryCode' in input ? (input.countryCode ?? null) : null,
    originCountryCode: input.type === 'flight' ? (input.originCountryCode ?? null) : null,
    // Every caller passes an explicit flag: the manual edit actions
    // and the re-extract path both recompute it against the trip
    // window (ADR-0008), so the chip always reflects the segment's
    // current dates. If we hard-coded `false` here, editing a segment
    // into an out-of-window date — or a re-extract that moved it there
    // — would silently drop the warning.
    needsReview,
    updatedAt: new Date(),
  };
}

// Update an existing segment in place. Same shape as `create` but
// keyed by segment id with an ownership check through the segment's
// trip. Type cannot change — the action layer rejects the request
// before reaching the repo if the incoming type differs from the row's
// stored type (data-shape and per-variant geography would otherwise
// have to be migrated). Returns the updated row, or null if not
// found / not owned.
//
// `opts.needsReview` is supplied explicitly by the only caller
// (`updateSegmentAction`), which recomputes it against the trip window
// on every edit (ADR-0008 window-truth). The `?? false` below is a
// defensive default for an omitted opt, not the edit behaviour — the
// extraction/re-extract path doesn't go through `update` at all (it
// uses `updateForActiveExtractionClaim`).
export async function update(
  userId: string,
  segmentId: string,
  input: SegmentCreateInput,
  opts: CreateOptions = {},
): Promise<Segment | null> {
  const rows = await db
    .update(segments)
    .set(setColumnsFromInput(input, opts.needsReview ?? false))
    .where(
      and(
        eq(segments.id, segmentId),
        sql`${segments.tripId} IN (SELECT ${trips.id} FROM ${trips} WHERE ${trips.userId} = ${userId})`,
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Outcome of {@link updateForActiveExtractionClaim}, distinguishing the
 * three "don't write" paths so the bridge can log and surface them
 * separately from a "wrote successfully" outcome.
 *
 * - `updated`: doc claim was clear AND segment was untouched since the
 *   claim was stamped — segment fields were rewritten.
 * - `superseded`: doc's `extractionStartedAt` has been re-stamped by a
 *   fresh re-extract since this job's `recordExtraction` cleared it.
 *   A newer job owns the row; we must not write the stale payload.
 * - `user-edited`: segment's `updatedAt` is newer than the claim stamp.
 *   The user saved their own edits during the extraction window. The
 *   user's value beats the LLM's; we link but don't overwrite.
 * - `not-found`: doc or segment doesn't exist for this user (concurrent
 *   delete).
 */
export type UpdateForClaimOutcome =
  | { outcome: 'updated'; segment: Segment }
  | { outcome: 'superseded' }
  | { outcome: 'user-edited' }
  | { outcome: 'not-found' };

/**
 * Update a segment as part of a completed extraction job, atomically
 * gated on two preconditions:
 *
 *   1. The document's `extractionStartedAt` is still NULL — i.e. the
 *      `recordExtraction` write that cleared it hasn't been
 *      superseded by a fresh re-extract stamping a new claim. Without
 *      this, a slow job whose `recordExtraction` succeeded would race
 *      a fresh re-click and overwrite a segment with stale data while
 *      the new job is mid-flight.
 *
 *   2. The segment's `updatedAt` is ≤ the claim stamp captured at
 *      `markExtractionStarted` time — i.e. the user hasn't saved a
 *      manual edit on this segment during the extraction window.
 *      `markExtractionStarted` wipes link rows but leaves segments
 *      alone, so the user can open the edit dialog and save while
 *      extraction is running. Their save sets `updatedAt = NOW()`
 *      and clears `needsReview`; we must not undo that by overwriting
 *      with the LLM's output.
 *
 * Both checks happen in a single tx with `SELECT … FOR UPDATE` on the
 * document, so a concurrent `markExtractionStarted` either lands
 * before us (we see the new claim, return `superseded`) or blocks
 * until we commit. The `user-edited` check is racy against an
 * `updateSegmentAction` that lands AFTER we read but BEFORE we write
 * — the cost is a single LLM payload overwriting one user save in
 * that narrow window, which we accept rather than locking the segment
 * row across the entire extraction job.
 */
export async function updateForActiveExtractionClaim(
  userId: string,
  segmentId: string,
  input: SegmentCreateInput,
  opts: CreateOptions,
  claim: { documentId: string; startedAt: Date },
): Promise<UpdateForClaimOutcome> {
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .select({ extractionStartedAt: documents.extractionStartedAt })
      .from(documents)
      .where(and(eq(documents.id, claim.documentId), eq(documents.userId, userId)))
      .for('update')
      .limit(1);
    if (!doc) return { outcome: 'not-found' };
    // Fresh re-extract has re-stamped the row; a newer job owns it.
    if (doc.extractionStartedAt !== null) return { outcome: 'superseded' };

    const [seg] = await tx
      .select({ updatedAt: segments.updatedAt })
      .from(segments)
      .innerJoin(trips, eq(segments.tripId, trips.id))
      .where(and(eq(segments.id, segmentId), eq(trips.userId, userId)))
      .limit(1);
    if (!seg) return { outcome: 'not-found' };
    if (seg.updatedAt > claim.startedAt) return { outcome: 'user-edited' };

    const rows = await tx
      .update(segments)
      .set(setColumnsFromInput(input, opts.needsReview ?? false))
      .where(
        and(
          eq(segments.id, segmentId),
          sql`${segments.tripId} IN (SELECT ${trips.id} FROM ${trips} WHERE ${trips.userId} = ${userId})`,
        ),
      )
      .returning();
    const row = rows[0];
    if (!row) return { outcome: 'not-found' };
    return { outcome: 'updated', segment: row };
  });
}

// Atomic batch update for the multi-leg flight-edit dialog. All N
// leg updates land in a single transaction — if any leg's
// ownership-scoped UPDATE returns zero rows (segment vanished
// mid-edit, or never owned by this user), the whole batch rolls back
// and the action returns a generic "Segment not found." Single-user
// app today, but the user-scoped predicate matters either way: a
// future household-sharing path would still be safe.
//
// Order is preserved in the returned array — the action layer relies
// on `legs[i]` ↔ `result[i]` to map per-leg field errors back to the
// originating tab.
//
// `needsReview` is per-leg: the action recomputes each leg's ADR-0008
// advisory against the trip window before calling in. Defaults to
// `false` when a leg omits it.
export async function updateMany(
  userId: string,
  legs: ReadonlyArray<{ id: string; input: SegmentCreateInput; needsReview?: boolean }>,
): Promise<Segment[]> {
  return db.transaction(async (tx) => {
    const out: Segment[] = [];
    for (const leg of legs) {
      const rows = await tx
        .update(segments)
        .set(setColumnsFromInput(leg.input, leg.needsReview ?? false))
        .where(
          and(
            eq(segments.id, leg.id),
            sql`${segments.tripId} IN (SELECT ${trips.id} FROM ${trips} WHERE ${trips.userId} = ${userId})`,
          ),
        )
        .returning();
      const row = rows[0];
      if (!row) throw new Error('SEGMENT_NOT_FOUND');
      out.push(row);
    }
    return out;
  });
}

// Sibling lookup for the multi-leg flight-edit dialog. A segment is a
// sibling of `segmentId` when either:
//   (a) it shares a linked document via {@link documentSegments} — the
//       common case for extracted multi-leg boarding passes, or
//   (b) it sits on the same trip and shares a non-empty `data.pnr` —
//       the manual case where the user has split a return trip into
//       two segments by hand and tied them via PNR.
//
// `segmentId` itself is included in the returned list so the caller
// has the full leg ordering without a second fetch. Always filtered
// to `type='flight'`; an extraction sibling that somehow became a
// non-flight (which would only happen via a manual type change we
// don't currently allow) is excluded — the dialog can't render it.
//
// Returns [] when the input segment isn't found, isn't owned, or
// isn't a flight. The caller should fall back to the single-segment
// form in that case.
export async function listFlightLegGroup(userId: string, segmentId: string): Promise<Segment[]> {
  const self = await getByIdForUser(userId, segmentId);
  if (!self || self.type !== 'flight') return [];

  // PNR for sibling matching. Reads defensively from JSONB — a
  // malformed `data` payload becomes null PNR (no PNR-side matches)
  // rather than a thrown error.
  const selfData = self.data as { pnr?: unknown } | null;
  const rawPnr = selfData && typeof selfData.pnr === 'string' ? selfData.pnr.trim() : '';
  const pnrToMatch = rawPnr !== '' ? rawPnr : null;

  // Documents this segment is linked to. The "doc-sibling" predicate
  // is "shares any document with self"; an empty array means no
  // doc-side matches.
  const linkedDocs = await db
    .select({ documentId: documentSegments.documentId })
    .from(documentSegments)
    .where(eq(documentSegments.segmentId, segmentId));
  const docIds = linkedDocs.map((r) => r.documentId);

  // Build the OR predicate dynamically. `undefined` clauses are
  // skipped by `or(...)` — when neither doc-side nor PNR-side has
  // matches we end up with an empty predicate which `or` returns
  // `undefined` for, so we early-out to [self] in that case.
  const docMatch =
    docIds.length > 0
      ? inArray(
          segments.id,
          db
            .select({ id: documentSegments.segmentId })
            .from(documentSegments)
            .where(inArray(documentSegments.documentId, docIds)),
        )
      : undefined;
  // The `data->>'pnr'` predicate is parameterised through Drizzle's
  // `sql` tag so the bound value is escaped — safe even though pnr is
  // user-controlled. There's no index on `data->>'pnr'`, but the
  // sibling AND-clause pins the scan to `self.tripId` first, so we
  // only sequential-scan flight segments on this one trip. Trip-scoped
  // segment counts are tiny by design — see the LIST_LIMIT cap.
  const pnrMatch = pnrToMatch
    ? and(eq(segments.tripId, self.tripId), sql`${segments.data}->>'pnr' = ${pnrToMatch}`)
    : undefined;

  // No sibling criteria at all → just return self. Avoids a
  // pointless ORDER BY pass over the whole flight table.
  if (!docMatch && !pnrMatch) return [self];

  // `or(a, b)` with one operand undefined returns the other; with
  // both undefined it returns undefined (already short-circuited
  // above). Narrow explicitly so the `and(..., combined)` call
  // doesn't compile against `SQL | undefined`.
  const combined = or(docMatch, pnrMatch);
  if (!combined) return [self];

  const rows = await db
    .select(segmentCols)
    .from(segments)
    .innerJoin(trips, eq(segments.tripId, trips.id))
    .where(and(eq(trips.userId, userId), eq(segments.type, 'flight'), combined))
    .orderBy(sql`${segments.startsAt} asc nulls last`, asc(segments.createdAt));

  // Defensive: if for any reason `self` didn't come back through the
  // joined query (it should — but the predicate dance is conservative),
  // splice it in at the chronologically-correct slot.
  if (!rows.some((r) => r.id === self.id)) rows.push(self);
  return rows;
}

// User-scoped delete via inner trip ownership check, returned as a
// boolean so the action layer can tell the user "already gone" vs.
// "removed".
export async function hardDelete(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(segments)
    .where(
      and(
        eq(segments.id, id),
        // Subquery: trip belongs to user. Drizzle's `inArray(subquery)`
        // would compile this to a single round-trip; we keep it inline
        // for clarity.
        sql`${segments.tripId} IN (SELECT ${trips.id} FROM ${trips} WHERE ${trips.userId} = ${userId})`,
      ),
    )
    .returning({ id: segments.id });
  return rows.length > 0;
}

// Segment types whose date is set / cleared via the quick reschedule
// dialog: activities (undated = a candidate) and food (undated = an
// in-trip shortlist pick). The `type` is passed by the action layer
// from the verified existing row and pinned in the WHERE so a mismatched
// caller can never restamp a flight or hotel.
export type SchedulableSegmentType = 'activity' | 'food';

// Stamps a segment's startsAt (and optionally endsAt) — promotes an
// undated activity / food pick to a scheduled one, or reschedules a
// dated one. Valid only for the schedulable types; the action layer
// verifies the type before calling and passes it through here. Food is a
// point in time with no end, so its endsAt is forced null here — the same
// invariant create() / update() enforce, applied at this write path too.
export async function scheduleSegment(
  userId: string,
  id: string,
  type: SchedulableSegmentType,
  startsAt: Date,
  endsAt: Date | null,
): Promise<Segment | null> {
  const [row] = await db
    .update(segments)
    .set({ startsAt, endsAt: type === 'food' ? null : endsAt, updatedAt: new Date() })
    .where(
      and(
        eq(segments.id, id),
        eq(segments.type, type),
        sql`${segments.tripId} IN (SELECT ${trips.id} FROM ${trips} WHERE ${trips.userId} = ${userId})`,
      ),
    )
    .returning();
  return row ?? null;
}

// Clears a segment's startsAt/endsAt — the inverse of scheduleSegment,
// returning an activity / food pick to its undated state. Same
// userId-via-trip ownership check and type pin.
export async function unscheduleSegment(
  userId: string,
  id: string,
  type: SchedulableSegmentType,
): Promise<Segment | null> {
  const [row] = await db
    .update(segments)
    .set({ startsAt: null, endsAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(segments.id, id),
        eq(segments.type, type),
        sql`${segments.tripId} IN (SELECT ${trips.id} FROM ${trips} WHERE ${trips.userId} = ${userId})`,
      ),
    )
    .returning();
  return row ?? null;
}
