// Unit tests for ensureSegmentForExtraction — the ADR-0008 bridge.
//
// Every outcome variant is pinned: no-segment (4 reasons), already-
// linked, linked-existing (dedup), linked-new (with and without
// needsReview), create-failed, link-failed.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Document } from '@/db/schema';
import type {
  BoardingPassPayload,
  FlightLeg,
  GenericPayload,
  HotelConfirmationPayload,
  StructuredPayload,
} from '@/lib/extraction';
import type { Segment } from '@/lib/segments/repo';
import type { Trip } from '@/lib/trips/repo';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getByIdForUser: vi.fn(),
  linkSegment: vi.fn(),
  listLinkedSegmentIds: vi.fn(),
  findFlightByKey: vi.fn(),
  createSegment: vi.fn(),
  updateSegment: vi.fn(),
  updateForActiveExtractionClaim: vi.fn(),
  hardDeleteSegment: vi.fn(),
  hardDeleteIfUnreferenced: vi.fn(),
  getTrip: vi.fn(),
  geocodeOnSegmentChange: vi.fn(),
}));

vi.mock('./repo', () => ({
  getByIdForUser: mocks.getByIdForUser,
  linkSegment: mocks.linkSegment,
  listLinkedSegmentIds: mocks.listLinkedSegmentIds,
}));

vi.mock('@/lib/segments/repo', () => ({
  findFlightByKey: mocks.findFlightByKey,
  create: mocks.createSegment,
  update: mocks.updateSegment,
  updateForActiveExtractionClaim: mocks.updateForActiveExtractionClaim,
  hardDelete: mocks.hardDeleteSegment,
  hardDeleteIfUnreferenced: mocks.hardDeleteIfUnreferenced,
}));

vi.mock('@/lib/trips/repo', () => ({
  getByIdForUser: mocks.getTrip,
}));

vi.mock('@/lib/geocoding', () => ({
  geocodeOnSegmentChange: mocks.geocodeOnSegmentChange,
}));

vi.mock('@/db/client', () => ({ db: {} }));

import { ensureSegmentForExtraction } from './segment-link';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';
const TRIP_ID = 'trip-aaa';
const DOC_ID = 'doc-bbb';

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: DOC_ID,
    userId: USER_ID,
    tripId: TRIP_ID,
    objectKey: '2026/05/abc.pdf',
    mime: 'application/pdf',
    bytes: 1024,
    sha256: 'deadbeef',
    originalName: 'boarding-pass.pdf',
    parsed: null,
    parsedBy: null,
    parsedConfidence: null,
    textMethod: null,
    extractionError: null,
    extractionStartedAt: null,
    overrides: {},
    reviewStatus: 'pending',
    orphanedAt: null,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  } as Document;
}

function makeTrip(
  start: Date | null = new Date(2026, 5, 1),
  end: Date | null = new Date(2026, 5, 10),
): Trip {
  return {
    id: TRIP_ID,
    userId: USER_ID,
    title: 'Test',
    summary: null,
    status: 'planned',
    coverImageId: null,
    startDate: start,
    endDate: end,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as unknown as Trip;
}

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'seg-1',
    tripId: TRIP_ID,
    type: 'flight',
    data: {},
    startsAt: new Date(2026, 5, 1),
    endsAt: null,
    locationName: null,
    countryCode: null,
    originCountryCode: null,
    needsReview: false,
    createdAt: new Date('2026-05-01'),
    updatedAt: new Date('2026-05-01'),
    ...overrides,
  } as Segment;
}

// Most tests vary one or two leg-level fields on a single flight
// (e.g. `flightNumber: null`). The factory takes a partial leg
// override so call sites stay compact; multi-leg cases can pass
// `flights` directly to override the whole array.
function boardingPass(
  legOverrides: Partial<FlightLeg> = {},
  payloadOverrides: Partial<Omit<BoardingPassPayload, 'flights'>> = {},
): BoardingPassPayload {
  const leg: FlightLeg = {
    carrier: 'BA',
    flightNumber: '287',
    flightDate: '2026-06-01',
    scheduledDeparture: null,
    scheduledArrival: null,
    origin: 'LHR',
    destination: 'SFO',
    passengerName: 'DOE/JANE',
    confirmationCode: 'ABC123',
    ...legOverrides,
  };
  return {
    kind: 'boarding-pass',
    flights: [leg],
    confidence: 0.9,
    ...payloadOverrides,
  };
}

function hotel(overrides: Partial<HotelConfirmationPayload> = {}): HotelConfirmationPayload {
  return {
    kind: 'hotel-confirmation',
    hotelName: 'Hotel California',
    checkIn: '2026-06-02',
    checkOut: '2026-06-05',
    address: '1 Sunset Blvd',
    confirmationCode: 'CONF-9',
    country: 'US',
    confidence: 0.81,
    ...overrides,
  };
}

function generic(): GenericPayload {
  return { kind: 'generic', summary: 'Generic', confidence: 0.4 };
}

// Fixed claim stamp used across tests. Real callers thread the timestamp
// `markExtractionStarted` captured into the bridge so the prior-link
// update path can gate its overwrite on the document's claim still
// being clear (no fresh re-extract has superseded) and the segment's
// `updatedAt` not having advanced past this stamp.
const CLAIM_STARTED_AT = new Date('2026-05-15T12:00:00Z');

async function call(payload: StructuredPayload, priorLinkedSegmentIds: string[] = []) {
  return ensureSegmentForExtraction({
    userId: USER_ID,
    tripId: TRIP_ID,
    documentId: DOC_ID,
    payload,
    priorLinkedSegmentIds,
    claim: { startedAt: CLAIM_STARTED_AT },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureSegmentForExtraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getByIdForUser.mockResolvedValue(makeDoc());
    mocks.linkSegment.mockResolvedValue(true);
    // Default: no pre-existing links — the idempotency short-circuit
    // is exercised only by tests that explicitly stage a hit.
    mocks.listLinkedSegmentIds.mockResolvedValue([]);
    mocks.findFlightByKey.mockResolvedValue(null);
    mocks.createSegment.mockResolvedValue(makeSegment());
    mocks.updateSegment.mockResolvedValue(makeSegment());
    // Default to a successful guarded update so most tests don't have
    // to stage the outcome explicitly. Tests for the superseded / user-
    // edited / not-found paths override per-call.
    mocks.updateForActiveExtractionClaim.mockResolvedValue({
      outcome: 'updated',
      segment: makeSegment(),
    });
    mocks.hardDeleteSegment.mockResolvedValue(true);
    mocks.hardDeleteIfUnreferenced.mockResolvedValue(true);
    mocks.getTrip.mockResolvedValue(makeTrip());
  });

  it('returns doc-missing when the document does not exist', async () => {
    mocks.getByIdForUser.mockResolvedValueOnce(null);

    const out = await call(boardingPass());

    expect(out).toEqual({ kind: 'no-segment', reason: 'doc-missing' });
    expect(mocks.createSegment).not.toHaveBeenCalled();
    expect(mocks.linkSegment).not.toHaveBeenCalled();
  });

  it('returns already-linked with all existing segment IDs (idempotency)', async () => {
    mocks.listLinkedSegmentIds.mockResolvedValueOnce(['seg-leg-1', 'seg-leg-2']);
    // The idempotency probe must only count extraction-created links —
    // manual links (#103) say nothing about whether the bridge ran, so
    // the bridge asks for the extraction slice explicitly.

    const out = await call(boardingPass());

    // Multi-flight world: the outcome surfaces every linked segment so
    // the caller can log/inspect the full set, not just a primary.
    expect(out).toEqual({ kind: 'already-linked', segmentIds: ['seg-leg-1', 'seg-leg-2'] });
    expect(mocks.listLinkedSegmentIds).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      {
        source: 'extraction',
      },
    );
    expect(mocks.findFlightByKey).not.toHaveBeenCalled();
    expect(mocks.createSegment).not.toHaveBeenCalled();
  });

  it('returns no-segment/generic for generic payloads', async () => {
    const out = await call(generic());

    expect(out).toEqual({ kind: 'no-segment', reason: 'generic' });
    expect(mocks.createSegment).not.toHaveBeenCalled();
  });

  it('returns no-segment/unmappable for hotels without a property name', async () => {
    const out = await call(hotel({ hotelName: null }));

    expect(out).toEqual({ kind: 'no-segment', reason: 'unmappable' });
    expect(mocks.createSegment).not.toHaveBeenCalled();
  });

  it('returns no-segment/trip-missing when the trip lookup returns null', async () => {
    mocks.getTrip.mockResolvedValueOnce(null);

    const out = await call(boardingPass());

    expect(out).toEqual({ kind: 'no-segment', reason: 'trip-missing' });
    expect(mocks.createSegment).not.toHaveBeenCalled();
  });

  describe('boarding-pass dedup', () => {
    it('links to an existing flight segment when (carrier, flightNumber, flightDate) match', async () => {
      const existing = makeSegment({ id: 'seg-existing-flight' });
      mocks.findFlightByKey.mockResolvedValueOnce(existing);

      const out = await call(boardingPass());

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'linked-existing', segmentId: 'seg-existing-flight', dedup: true }],
      });
      // After ADR-0009, the payload→segment mapper resolves the
      // carrier IATA to its airline name before writing, so dedup
      // operates on the resolved form. Legacy segments that still
      // store the bare IATA code may miss dedup against newly-
      // extracted boarding passes — acceptable at single-user scale.
      expect(mocks.findFlightByKey).toHaveBeenCalledWith(USER_ID, TRIP_ID, {
        carrier: 'British Airways',
        flightNumber: '287',
        // The mapper parses the payload's `YYYY-MM-DD` to UTC midnight,
        // so the expectation must be UTC-built — a local-midnight Date
        // here skews the suite on any non-UTC runner.
        flightDate: new Date(Date.UTC(2026, 5, 1)),
      });
      expect(mocks.createSegment).not.toHaveBeenCalled();
      expect(mocks.linkSegment).toHaveBeenCalledWith(USER_ID, DOC_ID, 'seg-existing-flight');
    });

    it('skips dedup lookup when any of carrier/flightNumber/flightDate is null', async () => {
      // Conservative match: the ADR explicitly rejects partial-key
      // dedup. A stub segment with a null flight number must not
      // collapse against any other flight.
      await call(boardingPass({ flightNumber: null }));
      expect(mocks.findFlightByKey).not.toHaveBeenCalled();
      expect(mocks.createSegment).toHaveBeenCalled();
    });
  });

  describe('re-extract: prior-link update path', () => {
    it('updates a dedup-matched segment when it was in priorLinks (re-extract overwrite)', async () => {
      // The dedup match IS the segment this document previously owned.
      // The bridge must overwrite its fields with the new payload (so a
      // bug-fix re-extract actually changes what the user sees) and
      // re-link, not just re-link.
      const existing = makeSegment({ id: 'seg-prior' });
      mocks.findFlightByKey.mockResolvedValueOnce(existing);
      mocks.updateForActiveExtractionClaim.mockResolvedValueOnce({
        outcome: 'updated',
        segment: makeSegment({ id: 'seg-prior' }),
      });

      const out = await call(boardingPass(), ['seg-prior']);

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'updated-prior', segmentId: 'seg-prior', needsReview: false }],
      });
      expect(mocks.updateForActiveExtractionClaim).toHaveBeenCalledTimes(1);
      expect(mocks.updateForActiveExtractionClaim).toHaveBeenCalledWith(
        USER_ID,
        'seg-prior',
        expect.objectContaining({ type: 'flight' }),
        { needsReview: false },
        { documentId: DOC_ID, startedAt: CLAIM_STARTED_AT },
      );
      expect(mocks.createSegment).not.toHaveBeenCalled();
      expect(mocks.linkSegment).toHaveBeenCalledWith(USER_ID, DOC_ID, 'seg-prior');
    });

    it('only LINKS (no update) when the dedup match is NOT in priorLinks (cross-doc dedup)', async () => {
      // Another boarding pass for the same flight from a different
      // document. We must not overwrite that segment's fields — the
      // other document is the authoritative owner.
      const existing = makeSegment({ id: 'seg-cross-doc' });
      mocks.findFlightByKey.mockResolvedValueOnce(existing);

      // priorLinks is empty (first extraction for this doc) but a
      // matching segment from another doc exists.
      const out = await call(boardingPass(), []);

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'linked-existing', segmentId: 'seg-cross-doc', dedup: true }],
      });
      expect(mocks.updateForActiveExtractionClaim).not.toHaveBeenCalled();
      expect(mocks.linkSegment).toHaveBeenCalledWith(USER_ID, DOC_ID, 'seg-cross-doc');
    });

    it('forwards needsReview to update when the new flight date falls outside the trip window', async () => {
      // Re-extract that moves the date outside the window must re-raise
      // the advisory flag — same semantics as fresh-create.
      mocks.getTrip.mockResolvedValueOnce(makeTrip(new Date(2026, 5, 1), new Date(2026, 5, 10)));
      const existing = makeSegment({ id: 'seg-prior' });
      mocks.findFlightByKey.mockResolvedValueOnce(existing);
      mocks.updateForActiveExtractionClaim.mockResolvedValueOnce({
        outcome: 'updated',
        segment: makeSegment({ id: 'seg-prior' }),
      });

      const out = await call(boardingPass({ flightDate: '2026-08-15' }), ['seg-prior']);

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'updated-prior', segmentId: 'seg-prior', needsReview: true }],
      });
      expect(mocks.updateForActiveExtractionClaim).toHaveBeenCalledWith(
        USER_ID,
        'seg-prior',
        expect.any(Object),
        { needsReview: true },
        { documentId: DOC_ID, startedAt: CLAIM_STARTED_AT },
      );
    });

    it('returns update-failed when the segment vanished between dedup and update', async () => {
      // Race: another writer hard-deleted the segment after our
      // findFlightByKey returned it. The guarded update reports
      // not-found; we surface the error rather than silently creating
      // a new segment (which would change the dedup-key semantics).
      const existing = makeSegment({ id: 'seg-prior' });
      mocks.findFlightByKey.mockResolvedValueOnce(existing);
      mocks.updateForActiveExtractionClaim.mockResolvedValueOnce({ outcome: 'not-found' });

      const out = await call(boardingPass(), ['seg-prior']);

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'update-failed', segmentId: 'seg-prior' }],
      });
      expect(mocks.linkSegment).not.toHaveBeenCalled();
    });

    it('returns update-failed when the update repo call throws', async () => {
      const existing = makeSegment({ id: 'seg-prior' });
      mocks.findFlightByKey.mockResolvedValueOnce(existing);
      mocks.updateForActiveExtractionClaim.mockRejectedValueOnce(new Error('boom'));

      const out = await call(boardingPass(), ['seg-prior']);

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'update-failed', segmentId: 'seg-prior' }],
      });
      expect(mocks.linkSegment).not.toHaveBeenCalled();
    });

    it('returns superseded (no link) when a fresh re-extract has restamped the claim', async () => {
      // recordExtraction succeeded (cleared the flag), then a new
      // markExtractionStarted re-stamped before the bridge ran. The
      // newer job owns the row; we must not overwrite the segment
      // with our now-stale payload AND must not link the doc to the
      // existing segment (the new job will write its own link).
      const existing = makeSegment({ id: 'seg-prior' });
      mocks.findFlightByKey.mockResolvedValueOnce(existing);
      mocks.updateForActiveExtractionClaim.mockResolvedValueOnce({ outcome: 'superseded' });

      const out = await call(boardingPass(), ['seg-prior']);

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'superseded', segmentId: 'seg-prior' }],
      });
      expect(mocks.linkSegment).not.toHaveBeenCalled();
    });

    it('returns user-edited and links (no overwrite) when the user edited the segment mid-extraction', async () => {
      // markExtractionStarted wipes link rows but leaves segments
      // alone, so the user can open the edit dialog and Save while
      // extraction is running. Their save advances segments.updatedAt
      // past the claim stamp; the bridge must preserve their edit but
      // still link the doc so the original is reachable from the
      // segment.
      const existing = makeSegment({ id: 'seg-prior' });
      mocks.findFlightByKey.mockResolvedValueOnce(existing);
      mocks.updateForActiveExtractionClaim.mockResolvedValueOnce({ outcome: 'user-edited' });

      const out = await call(boardingPass(), ['seg-prior']);

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'user-edited', segmentId: 'seg-prior' }],
      });
      expect(mocks.linkSegment).toHaveBeenCalledWith(USER_ID, DOC_ID, 'seg-prior');
    });

    it('returns link-failed if the link insert is itself rejected after a user-edited skip', async () => {
      // Belt-and-braces: even on the user-edited skip path, linkSegment
      // still runs its claim-token check (extractionStartedAt IS NULL).
      // If a fresh re-extract slipped in between our guarded update and
      // the link insert, the link refuses and we surface link-failed.
      const existing = makeSegment({ id: 'seg-prior' });
      mocks.findFlightByKey.mockResolvedValueOnce(existing);
      mocks.updateForActiveExtractionClaim.mockResolvedValueOnce({ outcome: 'user-edited' });
      mocks.linkSegment.mockResolvedValueOnce(false);

      const out = await call(boardingPass(), ['seg-prior']);

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'link-failed', segmentId: 'seg-prior' }],
      });
    });
  });

  describe('re-extract: orphan sweep', () => {
    it('hard-deletes a priorLink segment that the new extraction did not reuse', async () => {
      // The classic case the UI banner promises ("any segments
      // auto-created from the previous run will be replaced"). The
      // old extraction read the flight number wrong and now the new
      // dedup key doesn't match the stored segment, so a fresh
      // segment is created and the priorLink would otherwise hang
      // around as a duplicate flight on the trip.
      mocks.findFlightByKey.mockResolvedValueOnce(null);
      const created = makeSegment({ id: 'seg-new' });
      mocks.createSegment.mockResolvedValueOnce(created);

      const out = await call(boardingPass(), ['seg-stale']);

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'linked-new', segmentId: 'seg-new', needsReview: false }],
      });
      expect(mocks.hardDeleteIfUnreferenced).toHaveBeenCalledWith(USER_ID, 'seg-stale');
      expect(mocks.hardDeleteIfUnreferenced).toHaveBeenCalledTimes(1);
    });

    it('leaves a priorLink alone when the new extraction reused it via update', async () => {
      // Dedup-stable re-extract — the existing UPDATE path already
      // handles overwrite. The sweep must NOT also delete the
      // segment we just updated; the touched-IDs set protects against
      // that.
      const existing = makeSegment({ id: 'seg-prior' });
      mocks.findFlightByKey.mockResolvedValueOnce(existing);
      mocks.updateForActiveExtractionClaim.mockResolvedValueOnce({
        outcome: 'updated',
        segment: makeSegment({ id: 'seg-prior' }),
      });

      await call(boardingPass(), ['seg-prior']);

      expect(mocks.hardDeleteIfUnreferenced).not.toHaveBeenCalled();
    });

    it('skips the entire sweep when any leg returned superseded', async () => {
      // A newer claim has stamped the document mid-flight. The new
      // job is now responsible for orphan accounting — deleting on
      // its behalf would race against its own dedup logic.
      const existing = makeSegment({ id: 'seg-prior' });
      mocks.findFlightByKey.mockResolvedValueOnce(existing);
      mocks.updateForActiveExtractionClaim.mockResolvedValueOnce({ outcome: 'superseded' });

      await call(boardingPass(), ['seg-prior', 'seg-other-orphan']);

      expect(mocks.hardDeleteIfUnreferenced).not.toHaveBeenCalled();
    });

    it('sweeps only the un-reused subset of priorLinks', async () => {
      // priorLinks holds two segments. The new payload's single leg
      // dedups back to seg-kept (an in-place update), so only
      // seg-dropped is the orphan to sweep — the touched-IDs set
      // protects seg-kept.
      const kept = makeSegment({ id: 'seg-kept' });
      mocks.findFlightByKey.mockResolvedValueOnce(kept);
      mocks.updateForActiveExtractionClaim.mockResolvedValueOnce({
        outcome: 'updated',
        segment: makeSegment({ id: 'seg-kept' }),
      });

      await call(boardingPass(), ['seg-kept', 'seg-dropped']);

      expect(mocks.hardDeleteIfUnreferenced).toHaveBeenCalledTimes(1);
      expect(mocks.hardDeleteIfUnreferenced).toHaveBeenCalledWith(USER_ID, 'seg-dropped');
    });

    it('logs and continues when hardDelete throws on one orphan', async () => {
      // Best-effort: one stuck row must not fail the whole
      // extraction. Subsequent priorLinks must still be attempted.
      mocks.findFlightByKey.mockResolvedValue(null);
      mocks.createSegment.mockResolvedValueOnce(makeSegment({ id: 'seg-new' }));
      mocks.hardDeleteIfUnreferenced
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValueOnce(true);

      const out = await call(boardingPass(), ['seg-stale-1', 'seg-stale-2']);

      expect(out.kind).toBe('linked');
      expect(mocks.hardDeleteIfUnreferenced).toHaveBeenCalledTimes(2);
    });

    it('keeps a priorLink segment that another document still references', async () => {
      // The #103 invariant: our own extraction links were wiped by
      // markExtractionStarted, so any row left on the segment belongs
      // to a different document or a manual attach. The reference
      // check lives inside hardDeleteIfUnreferenced (an atomic
      // NOT EXISTS on the DELETE); the bridge just observes the
      // "kept" outcome and must not treat it as a failure.
      mocks.findFlightByKey.mockResolvedValueOnce(null);
      mocks.createSegment.mockResolvedValueOnce(makeSegment({ id: 'seg-new' }));
      mocks.hardDeleteIfUnreferenced.mockResolvedValueOnce(false);

      const out = await call(boardingPass(), ['seg-manually-backed']);

      expect(out.kind).toBe('linked');
      expect(mocks.hardDeleteIfUnreferenced).toHaveBeenCalledWith(USER_ID, 'seg-manually-backed');
    });
  });

  describe('segment creation', () => {
    it('creates a fresh segment when no dedup match exists', async () => {
      const created = makeSegment({ id: 'seg-new-flight' });
      mocks.createSegment.mockResolvedValueOnce(created);

      const out = await call(boardingPass());

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'linked-new', segmentId: 'seg-new-flight', needsReview: false }],
      });
      expect(mocks.createSegment).toHaveBeenCalledTimes(1);
      expect(mocks.linkSegment).toHaveBeenCalledWith(USER_ID, DOC_ID, 'seg-new-flight');
    });

    it('flags needsReview when the flight date falls outside the trip window', async () => {
      // Trip is Jun 1–10, flight is Aug 15. Way outside.
      mocks.getTrip.mockResolvedValueOnce(makeTrip(new Date(2026, 5, 1), new Date(2026, 5, 10)));
      const created = makeSegment({ id: 'seg-out-of-window' });
      mocks.createSegment.mockResolvedValueOnce(created);

      const out = await call(boardingPass({ flightDate: '2026-08-15' }));

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'linked-new', segmentId: 'seg-out-of-window', needsReview: true }],
      });
      expect(mocks.createSegment).toHaveBeenCalledWith(
        USER_ID,
        TRIP_ID,
        expect.objectContaining({ type: 'flight' }),
        { needsReview: true },
      );
    });

    it('does NOT flag needsReview within the ±2 day tolerance (day-before red-eye)', async () => {
      mocks.getTrip.mockResolvedValueOnce(makeTrip(new Date(2026, 5, 1), new Date(2026, 5, 10)));

      // Flight on the day before the trip's nominal start.
      await call(boardingPass({ flightDate: '2026-05-31' }));

      expect(mocks.createSegment).toHaveBeenCalledWith(USER_ID, TRIP_ID, expect.anything(), {
        needsReview: false,
      });
    });

    it('does NOT flag needsReview for wishlist trips with null dates', async () => {
      mocks.getTrip.mockResolvedValueOnce(makeTrip(null, null));

      await call(boardingPass({ flightDate: '2099-01-01' }));

      expect(mocks.createSegment).toHaveBeenCalledWith(USER_ID, TRIP_ID, expect.anything(), {
        needsReview: false,
      });
    });

    it('returns create-failed when segments.create throws', async () => {
      mocks.createSegment.mockRejectedValueOnce(new Error('TRIP_NOT_FOUND'));

      const out = await call(boardingPass());

      expect(out).toEqual({ kind: 'linked', items: [{ kind: 'create-failed' }] });
      expect(mocks.linkSegment).not.toHaveBeenCalled();
    });
  });

  describe('linking outcomes', () => {
    it('returns link-failed when linkSegment returns false for an existing segment', async () => {
      mocks.findFlightByKey.mockResolvedValueOnce(makeSegment({ id: 'seg-existing' }));
      mocks.linkSegment.mockResolvedValueOnce(false);

      const out = await call(boardingPass());

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'link-failed', segmentId: 'seg-existing' }],
      });
    });

    it('returns link-failed when linkSegment returns false for a freshly-created segment', async () => {
      // Real-world cause: a concurrent re-extract re-marked the doc
      // between `recordExtraction` and `linkSegment`; linkSegment's
      // `extractionStartedAt IS NULL` guard rejects this stale job's
      // link. The just-created segment is orphaned and gets cleaned
      // up best-effort so the trip doesn't accumulate empty flights.
      mocks.createSegment.mockResolvedValueOnce(makeSegment({ id: 'seg-new' }));
      mocks.linkSegment.mockResolvedValueOnce(false);

      const out = await call(boardingPass());

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'link-failed', segmentId: 'seg-new' }],
      });
      expect(mocks.hardDeleteSegment).toHaveBeenCalledWith(USER_ID, 'seg-new');
    });

    it('does NOT delete the existing segment when link-failed via dedup', async () => {
      // The dedup-matched segment may have other docs linked to it
      // (family travellers on one flight). A link failure on this
      // doc's row must not nuke the shared segment.
      mocks.findFlightByKey.mockResolvedValueOnce(makeSegment({ id: 'seg-existing' }));
      mocks.linkSegment.mockResolvedValueOnce(false);

      await call(boardingPass());

      expect(mocks.hardDeleteSegment).not.toHaveBeenCalled();
    });
  });

  describe('multi-flight payloads', () => {
    it('creates one segment per leg and links each', async () => {
      // Widen the default trip window so both legs of the return trip
      // sit comfortably inside it — the needsReview flag is exercised
      // by its own single-leg test above; this test pins the
      // per-leg create+link flow.
      mocks.getTrip.mockResolvedValueOnce(makeTrip(new Date(2026, 5, 1), new Date(2026, 5, 20)));
      const outboundSeg = makeSegment({ id: 'seg-outbound' });
      const inboundSeg = makeSegment({ id: 'seg-inbound' });
      mocks.createSegment.mockResolvedValueOnce(outboundSeg).mockResolvedValueOnce(inboundSeg);

      const payload: StructuredPayload = {
        kind: 'boarding-pass',
        flights: [
          {
            carrier: 'BA',
            flightNumber: '287',
            flightDate: '2026-06-01',
            scheduledDeparture: null,
            scheduledArrival: null,
            origin: 'LHR',
            destination: 'SFO',
            passengerName: 'DOE/JANE',
            confirmationCode: 'ABC123',
          },
          {
            carrier: 'BA',
            flightNumber: '286',
            flightDate: '2026-06-15',
            scheduledDeparture: null,
            scheduledArrival: null,
            origin: 'SFO',
            destination: 'LHR',
            passengerName: 'DOE/JANE',
            confirmationCode: 'ABC123',
          },
        ],
        confidence: 0.9,
      };

      const out = await ensureSegmentForExtraction({
        userId: USER_ID,
        tripId: TRIP_ID,
        documentId: DOC_ID,
        payload,
        claim: { startedAt: CLAIM_STARTED_AT },
      });

      expect(out).toEqual({
        kind: 'linked',
        items: [
          { kind: 'linked-new', segmentId: 'seg-outbound', needsReview: false },
          { kind: 'linked-new', segmentId: 'seg-inbound', needsReview: false },
        ],
      });
      expect(mocks.createSegment).toHaveBeenCalledTimes(2);
      expect(mocks.linkSegment).toHaveBeenCalledWith(USER_ID, DOC_ID, 'seg-outbound');
      expect(mocks.linkSegment).toHaveBeenCalledWith(USER_ID, DOC_ID, 'seg-inbound');
    });

    it('partial dedup: leg 1 links to existing, leg 2 creates a fresh segment', async () => {
      // Real-world case: the outbound flight was already extracted
      // from a separate confirmation; the inbound is new. The dedup
      // path catches the outbound; the create path runs for the
      // inbound.
      mocks.getTrip.mockResolvedValueOnce(makeTrip(new Date(2026, 5, 1), new Date(2026, 5, 20)));
      const existingOutbound = makeSegment({ id: 'seg-existing-outbound' });
      const newInbound = makeSegment({ id: 'seg-new-inbound' });
      mocks.findFlightByKey
        .mockResolvedValueOnce(existingOutbound) // dedup hit for leg 1
        .mockResolvedValueOnce(null); // miss for leg 2 → create
      mocks.createSegment.mockResolvedValueOnce(newInbound);

      const payload: StructuredPayload = {
        kind: 'boarding-pass',
        flights: [
          {
            carrier: 'BA',
            flightNumber: '287',
            flightDate: '2026-06-01',
            scheduledDeparture: null,
            scheduledArrival: null,
            origin: 'LHR',
            destination: 'SFO',
            passengerName: 'DOE/JANE',
            confirmationCode: 'ABC123',
          },
          {
            carrier: 'BA',
            flightNumber: '286',
            flightDate: '2026-06-15',
            scheduledDeparture: null,
            scheduledArrival: null,
            origin: 'SFO',
            destination: 'LHR',
            passengerName: 'DOE/JANE',
            confirmationCode: 'ABC123',
          },
        ],
        confidence: 0.9,
      };

      const out = await ensureSegmentForExtraction({
        userId: USER_ID,
        tripId: TRIP_ID,
        documentId: DOC_ID,
        payload,
        claim: { startedAt: CLAIM_STARTED_AT },
      });

      expect(out).toEqual({
        kind: 'linked',
        items: [
          { kind: 'linked-existing', segmentId: 'seg-existing-outbound', dedup: true },
          { kind: 'linked-new', segmentId: 'seg-new-inbound', needsReview: false },
        ],
      });
      // Only the inbound is created — outbound was deduped.
      expect(mocks.createSegment).toHaveBeenCalledTimes(1);
    });
  });

  describe('hotel-confirmation', () => {
    it('creates a hotel segment from a full hotel payload', async () => {
      const created = makeSegment({ id: 'seg-hotel', type: 'hotel' });
      mocks.createSegment.mockResolvedValueOnce(created);

      const out = await call(hotel());

      expect(out).toEqual({
        kind: 'linked',
        items: [{ kind: 'linked-new', segmentId: 'seg-hotel', needsReview: false }],
      });
      // Dedup is boarding-pass only.
      expect(mocks.findFlightByKey).not.toHaveBeenCalled();
      expect(mocks.createSegment).toHaveBeenCalledWith(
        USER_ID,
        TRIP_ID,
        expect.objectContaining({ type: 'hotel' }),
        { needsReview: false },
      );
    });
  });
});
