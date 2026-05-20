// Unit tests for the user-facing `extractDocumentAction`.
//
// The action enqueues extraction onto the Jobs interface and returns
// immediately. The actual work runs in a captured thunk that we
// invoke explicitly inside each test — so we cover both contracts:
//
//   - the synchronous return value the click sees,
//   - the side-effects the background job produces on the row.
//
// We deliberately do NOT mock `@/db/client` — the action never touches
// `db` directly; everything goes through `./repo`. Pool construction
// in `client.ts` is lazy, so the import is inert in node tests.
//
// Order matters: `vi.mock(...)` is hoisted above imports. The mock
// factories close over module-scoped `vi.fn()` handles so each test
// can re-stub the return value.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Document } from '@/db/schema';
import type { LLMExtractor, StructuredPayload } from '@/lib/extraction';
import type { ExtractDocumentResult } from '@/lib/extraction/orchestrator';

// ---------------------------------------------------------------------------
// Mocks (hoisted to module top by Vitest before any of the imports below)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // captured by the fake Jobs implementation; tests run them explicitly
  const enqueued: Array<() => Promise<void>> = [];
  return {
    requireUser: vi.fn(),
    getByIdForUser: vi.fn(),
    markExtractionStarted: vi.fn(),
    clearExtractionStarted: vi.fn(),
    recordExtraction: vi.fn(),
    updateParsed: vi.fn(),
    resetStaleExtractions: vi.fn(),
    createOllamaExtractor: vi.fn(),
    extractDocument: vi.fn(),
    ensureSegmentForExtraction: vi.fn(),
    getDefaultDirectExtractors: vi.fn(),
    getDefaultExtractors: vi.fn(),
    getStorage: vi.fn(),
    revalidatePath: vi.fn(),
    enqueued,
    getJobs: vi.fn(() => ({
      enqueue(work: () => Promise<void>) {
        enqueued.push(work);
      },
    })),
  };
});

vi.mock('@/lib/auth/session', () => ({
  requireUser: mocks.requireUser,
}));

vi.mock('./repo', () => ({
  getByIdForUser: mocks.getByIdForUser,
  markExtractionStarted: mocks.markExtractionStarted,
  clearExtractionStarted: mocks.clearExtractionStarted,
  recordExtraction: mocks.recordExtraction,
  updateParsed: mocks.updateParsed,
  resetStaleExtractions: mocks.resetStaleExtractions,
  // The other repo exports aren't called from extract / parsed
  // actions — stubs that throw if accidentally invoked surface a
  // refactor regression at the seam.
  listForTrip: vi.fn(() => {
    throw new Error('repo.listForTrip should not be called from extractDocumentAction');
  }),
  create: vi.fn(() => {
    throw new Error('repo.create should not be called from extractDocumentAction');
  }),
  hardDelete: vi.fn(() => {
    throw new Error('repo.hardDelete should not be called from extractDocumentAction');
  }),
}));

// `structuredPayloadSchema` is the real Zod schema — the action
// uses it to validate parsed-edit input, and the tests assert the
// validation behaviour. Pull it from the actual module via
// importOriginal so we don't have to mirror the schema in the mock.
vi.mock('@/lib/extraction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/extraction')>();
  return {
    ...actual,
    createOllamaExtractor: mocks.createOllamaExtractor,
    extractDocument: mocks.extractDocument,
    getDefaultDirectExtractors: mocks.getDefaultDirectExtractors,
  };
});

vi.mock('./segment-link', () => ({
  ensureSegmentForExtraction: mocks.ensureSegmentForExtraction,
}));

vi.mock('@/lib/jobs', () => ({
  getJobs: mocks.getJobs,
}));

vi.mock('@/lib/ocr', () => ({
  getDefaultExtractors: mocks.getDefaultExtractors,
}));

vi.mock('@/lib/storage', () => ({
  getStorage: mocks.getStorage,
  StorageRejectedError: class StorageRejectedError extends Error {
    constructor(
      message: string,
      public readonly reason: 'mime-mismatch' | 'mime-not-allowed' | 'too-large',
    ) {
      super(message);
      this.name = 'StorageRejectedError';
    }
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('@/db/client', () => ({
  db: {},
}));

// Import AFTER the vi.mock hoists.
import { deleteDocumentAction, extractDocumentAction, updateParsedAction } from './actions';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = { id: 'user-1' } as const;
const TRIP_ID = 'trip-aaa';
const DOC_ID = 'doc-bbb';
// Claim timestamp — what `markExtractionStarted` returns for tests that
// run past the synchronous gate. The action reads this as the
// concurrency token; every recordExtraction/clearExtractionStarted
// assertion below expects it as the trailing argument.
const CLAIM_AT = new Date('2026-05-15T18:00:00Z');

// `markExtractionStarted` returns the freshly-stamped doc plus the
// prior-link segment IDs the bridge will use for the re-extract
// update path. Tests that don't care about priorLinks default it to
// empty; the few that exercise re-extract pass a non-empty array.
function markedExtraction(
  docOverrides: Partial<Document> = {},
  priorLinkedSegmentIds: string[] = [],
): { document: Document; priorLinkedSegmentIds: string[] } {
  return {
    document: makeDocument({ extractionStartedAt: CLAIM_AT, ...docOverrides }),
    priorLinkedSegmentIds,
  };
}

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: DOC_ID,
    userId: USER.id,
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

function fakeLlm(): LLMExtractor {
  return { structure: async () => null };
}

const OK_BOARDING_PAYLOAD: StructuredPayload = {
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
  ],
  confidence: 0.9,
};

// Drain any thunks the action enqueued. Tests that care about the
// job body call this; tests that only care about the action's return
// value can leave the queue full and assert it.
async function runEnqueuedJobs(): Promise<void> {
  while (mocks.enqueued.length > 0) {
    const work = mocks.enqueued.shift()!;
    await work();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractDocumentAction — synchronous (enqueue + return)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueued.length = 0;
    mocks.requireUser.mockResolvedValue(USER);
    mocks.createOllamaExtractor.mockReturnValue(fakeLlm());
    mocks.getDefaultDirectExtractors.mockReturnValue([]);
    mocks.getDefaultExtractors.mockReturnValue([]);
    mocks.getStorage.mockReturnValue({});
    mocks.resetStaleExtractions.mockResolvedValue(0);
    mocks.ensureSegmentForExtraction.mockResolvedValue({
      kind: 'no-segment',
      reason: 'generic',
    });
  });

  it('propagates the auth failure when requireUser throws', async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(extractDocumentAction(TRIP_ID, DOC_ID)).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.getByIdForUser).not.toHaveBeenCalled();
    expect(mocks.markExtractionStarted).not.toHaveBeenCalled();
    expect(mocks.enqueued).toHaveLength(0);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('returns "Document not found." when the doc is not owned by the user', async () => {
    mocks.getByIdForUser.mockResolvedValueOnce(null);

    const result = await extractDocumentAction(TRIP_ID, DOC_ID);

    expect(result).toEqual({ ok: false, error: { formMessage: 'Document not found.' } });
    expect(mocks.getByIdForUser).toHaveBeenCalledWith(USER.id, DOC_ID);
    expect(mocks.markExtractionStarted).not.toHaveBeenCalled();
    expect(mocks.enqueued).toHaveLength(0);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects when the supplied tripId does not match the document’s tripId', async () => {
    // Defense in depth: the client could submit any of the user's
    // own trip IDs alongside any of their own document IDs. Without
    // this check, segments would be created on the wrong trip and
    // the wrong path would be revalidated. Same user, still a
    // defect — refuse instead of silently landing on the wrong trip.
    mocks.getByIdForUser.mockResolvedValueOnce(makeDocument({ tripId: 'trip-other' }));

    const result = await extractDocumentAction(TRIP_ID, DOC_ID);

    expect(result).toEqual({
      ok: false,
      error: { formMessage: 'Document does not belong to this trip.' },
    });
    expect(mocks.markExtractionStarted).not.toHaveBeenCalled();
    expect(mocks.enqueued).toHaveLength(0);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('returns a friendly error when Ollama is not configured — does NOT enqueue', async () => {
    mocks.getByIdForUser.mockResolvedValueOnce(makeDocument());
    mocks.createOllamaExtractor.mockImplementationOnce(() => {
      throw new Error('OLLAMA_URL is not set');
    });

    const result = await extractDocumentAction(TRIP_ID, DOC_ID);

    expect(result).toEqual({
      ok: false,
      error: { formMessage: 'Extraction is not configured on this server.' },
    });
    expect(mocks.markExtractionStarted).not.toHaveBeenCalled();
    expect(mocks.enqueued).toHaveLength(0);
  });

  it('happy path: marks extracting, enqueues a job, revalidates, returns queued', async () => {
    const doc = makeDocument();
    mocks.getByIdForUser.mockResolvedValueOnce(doc);
    mocks.markExtractionStarted.mockResolvedValueOnce(markedExtraction());

    const result = await extractDocumentAction(TRIP_ID, DOC_ID);

    expect(result).toEqual({ ok: true, value: { status: 'queued' } });
    expect(mocks.markExtractionStarted).toHaveBeenCalledWith(USER.id, DOC_ID);
    expect(mocks.resetStaleExtractions).toHaveBeenCalledWith(USER.id, expect.any(Number));
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/trips/${TRIP_ID}`, 'layout');
    expect(mocks.enqueued).toHaveLength(1);

    // Synchronous path must NOT touch the orchestrator or recordExtraction —
    // those are the job body's responsibility.
    expect(mocks.extractDocument).not.toHaveBeenCalled();
    expect(mocks.recordExtraction).not.toHaveBeenCalled();
  });

  it('returns not-found when markExtractionStarted finds nothing (TOCTOU)', async () => {
    mocks.getByIdForUser.mockResolvedValueOnce(makeDocument());
    mocks.markExtractionStarted.mockResolvedValueOnce(null);

    const result = await extractDocumentAction(TRIP_ID, DOC_ID);

    expect(result).toEqual({ ok: false, error: { formMessage: 'Document not found.' } });
    expect(mocks.enqueued).toHaveLength(0);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('extractDocumentAction — background job body', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueued.length = 0;
    mocks.requireUser.mockResolvedValue(USER);
    mocks.createOllamaExtractor.mockReturnValue(fakeLlm());
    mocks.getDefaultDirectExtractors.mockReturnValue([]);
    mocks.getDefaultExtractors.mockReturnValue([]);
    mocks.getStorage.mockReturnValue({});
    mocks.resetStaleExtractions.mockResolvedValue(0);
    mocks.ensureSegmentForExtraction.mockResolvedValue({
      kind: 'no-segment',
      reason: 'generic',
    });
    mocks.markExtractionStarted.mockResolvedValue(markedExtraction());
  });

  async function enqueueAndRun(
    jobReturns: ExtractDocumentResult,
    docOverrides?: Partial<Document>,
  ) {
    const doc = makeDocument(docOverrides);
    mocks.getByIdForUser.mockResolvedValue(doc);
    mocks.extractDocument.mockResolvedValueOnce(jobReturns);
    mocks.recordExtraction.mockResolvedValueOnce(doc);

    const result = await extractDocumentAction(TRIP_ID, DOC_ID);
    expect(result).toEqual({ ok: true, value: { status: 'queued' } });

    // Now run the captured job(s).
    await runEnqueuedJobs();
    return doc;
  }

  it('happy path: job persists the structured payload and clears extractionError', async () => {
    await enqueueAndRun({
      status: 'ok',
      parsed: OK_BOARDING_PAYLOAD,
      sourceMethod: 'llm-local',
      confidence: 0.9,
      textMethod: 'pdf-text',
      charsExtracted: 200,
    });

    expect(mocks.recordExtraction).toHaveBeenCalledTimes(1);
    expect(mocks.recordExtraction).toHaveBeenCalledWith(
      USER.id,
      DOC_ID,
      {
        parsed: OK_BOARDING_PAYLOAD,
        parsedBy: 'llm-local',
        parsedConfidence: 0.9,
        textMethod: 'pdf-text',
        extractionError: null,
      },
      CLAIM_AT,
    );
    // Twice: once on the synchronous enqueue, once on completion.
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/trips/${TRIP_ID}`, 'layout');
  });

  it('pkpass direct path: textMethod is null and parsedBy is pkpass', async () => {
    await enqueueAndRun(
      {
        status: 'ok',
        parsed: OK_BOARDING_PAYLOAD,
        sourceMethod: 'pkpass',
        confidence: 1,
        textMethod: null,
        charsExtracted: 0,
      },
      {
        mime: 'application/vnd.apple.pkpass',
        objectKey: '2026/05/boarding.pkpass',
        originalName: 'boarding.pkpass',
      },
    );

    expect(mocks.recordExtraction).toHaveBeenCalledWith(
      USER.id,
      DOC_ID,
      {
        parsed: OK_BOARDING_PAYLOAD,
        parsedBy: 'pkpass',
        parsedConfidence: 1,
        textMethod: null,
        extractionError: null,
      },
      CLAIM_AT,
    );
  });

  it('records failure reason and revalidates when orchestrator yields llm-unavailable', async () => {
    await enqueueAndRun({
      status: 'failed',
      reason: 'llm-unavailable',
    });

    expect(mocks.recordExtraction).toHaveBeenCalledWith(
      USER.id,
      DOC_ID,
      {
        parsed: null,
        parsedBy: null,
        parsedConfidence: null,
        textMethod: null,
        extractionError: 'llm-unavailable',
      },
      CLAIM_AT,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/trips/${TRIP_ID}`, 'layout');
  });

  it('TOCTOU during job: doc deleted between markExtractionStarted and the read inside the job', async () => {
    // Synchronous path: doc found, mark succeeded, action returns queued.
    mocks.getByIdForUser.mockResolvedValueOnce(makeDocument());

    const result = await extractDocumentAction(TRIP_ID, DOC_ID);
    expect(result).toEqual({ ok: true, value: { status: 'queued' } });

    // Inside the job, the re-read returns null — doc was deleted.
    mocks.getByIdForUser.mockResolvedValueOnce(null);
    await runEnqueuedJobs();

    expect(mocks.extractDocument).not.toHaveBeenCalled();
    expect(mocks.recordExtraction).not.toHaveBeenCalled();
  });

  it('calls ensureSegmentForExtraction with the parsed payload on success', async () => {
    // The ADR-0008 bridge runs after recordExtraction succeeds. Verify
    // the wiring: same userId, tripId, documentId, and the exact
    // parsed payload returned by the orchestrator.
    await enqueueAndRun({
      status: 'ok',
      parsed: OK_BOARDING_PAYLOAD,
      sourceMethod: 'llm-local',
      confidence: 0.9,
      textMethod: 'pdf-text',
      charsExtracted: 200,
    });

    expect(mocks.ensureSegmentForExtraction).toHaveBeenCalledTimes(1);
    expect(mocks.ensureSegmentForExtraction).toHaveBeenCalledWith({
      userId: USER.id,
      tripId: TRIP_ID,
      documentId: DOC_ID,
      payload: OK_BOARDING_PAYLOAD,
      // Empty on first extraction — the default mock returns no prior
      // links. The re-extract update path is exercised in segment-link
      // tests where priorLinks is non-empty.
      priorLinkedSegmentIds: [],
      // The bridge's prior-link update path gates on this stamp so a
      // slow job whose recordExtraction succeeded can still be vetoed
      // by a fresher re-extract that re-stamped the doc claim, and
      // user edits saved during the extraction window are preserved
      // (segments.updatedAt > startedAt → no overwrite).
      claim: { startedAt: CLAIM_AT },
    });
  });

  it('does NOT call ensureSegmentForExtraction on extraction failure', async () => {
    // The ADR-0008 bridge only fires for the ok branch; a failed
    // extraction has no payload to map and no segment to attach.
    await enqueueAndRun({ status: 'failed', reason: 'llm-unavailable' });

    expect(mocks.ensureSegmentForExtraction).not.toHaveBeenCalled();
  });

  it('swallows segment-link errors so the extraction outcome stands', async () => {
    // ADR-0008's bridge is best-effort — extraction has already
    // persisted by the time we reach it. A throw here must not
    // change the user-facing outcome.
    mocks.ensureSegmentForExtraction.mockRejectedValueOnce(new Error('segments table missing'));

    await enqueueAndRun({
      status: 'ok',
      parsed: OK_BOARDING_PAYLOAD,
      sourceMethod: 'llm-local',
      confidence: 0.9,
      textMethod: 'pdf-text',
      charsExtracted: 200,
    });

    // recordExtraction landed; revalidate still fired.
    expect(mocks.recordExtraction).toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it('lost Ollama config during job: clears extractionStartedAt so UI is not stuck', async () => {
    mocks.getByIdForUser.mockResolvedValueOnce(makeDocument());

    const result = await extractDocumentAction(TRIP_ID, DOC_ID);
    expect(result).toEqual({ ok: true, value: { status: 'queued' } });

    // Job runs and the second createOllamaExtractor call throws.
    mocks.getByIdForUser.mockResolvedValueOnce(makeDocument());
    mocks.createOllamaExtractor.mockImplementationOnce(() => {
      throw new Error('OLLAMA_URL is not set');
    });
    mocks.clearExtractionStarted.mockResolvedValueOnce(true);
    await runEnqueuedJobs();

    expect(mocks.clearExtractionStarted).toHaveBeenCalledWith(USER.id, DOC_ID, CLAIM_AT);
    expect(mocks.extractDocument).not.toHaveBeenCalled();
    expect(mocks.recordExtraction).not.toHaveBeenCalled();
  });

  it('passes objectKey/mime/bytes through to the orchestrator and never re-introduces a hint', async () => {
    const doc = makeDocument({ originalName: 'paris-hotel.pdf', mime: 'application/pdf' });
    mocks.getByIdForUser.mockResolvedValue(doc);
    mocks.extractDocument.mockResolvedValueOnce({
      status: 'failed',
      reason: 'llm-unavailable',
    } satisfies ExtractDocumentResult);
    mocks.recordExtraction.mockResolvedValueOnce(doc);

    await extractDocumentAction(TRIP_ID, DOC_ID);
    await runEnqueuedJobs();

    expect(mocks.extractDocument).toHaveBeenCalledTimes(1);
    const [input] = mocks.extractDocument.mock.calls[0]!;
    expect(input).toEqual({
      objectKey: doc.objectKey,
      mime: doc.mime,
      bytes: doc.bytes,
    });
  });
});

// ---------------------------------------------------------------------------
// updateParsedAction — manual edits to documents.parsed
// ---------------------------------------------------------------------------

describe('updateParsedAction', () => {
  // Minimal-valid boarding-pass payload for happy-path edits. Confidence
  // is preserved across the action; the dialog doesn't expose it.
  const VALID_BOARDING_PAYLOAD = {
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
    ],
    confidence: 0.92,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(USER);
    // Default: the document exists, is owned by this user, and is
    // attached to TRIP_ID. The cross-check passes by default; tests
    // that exercise the rejection path override this mock.
    mocks.getByIdForUser.mockResolvedValue(makeDocument());
  });

  it('propagates the auth failure when requireUser throws', async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(updateParsedAction(TRIP_ID, DOC_ID, VALID_BOARDING_PAYLOAD)).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(mocks.updateParsed).not.toHaveBeenCalled();
  });

  it('rejects when the supplied tripId does not match the document’s tripId', async () => {
    // Same defense-in-depth check as extractDocumentAction. Refuse
    // rather than writing to a doc that's actually on a different
    // trip than the action was framed against.
    mocks.getByIdForUser.mockResolvedValueOnce(makeDocument({ tripId: 'trip-other' }));

    const result = await updateParsedAction(TRIP_ID, DOC_ID, VALID_BOARDING_PAYLOAD);

    expect(result).toEqual({
      ok: false,
      error: { formMessage: 'Document does not belong to this trip.' },
    });
    expect(mocks.updateParsed).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('returns flattened field errors on schema validation failure', async () => {
    // `confidence` is required + must be 0..1; missing it should
    // produce a field-level error the dialog can render inline.
    const result = await updateParsedAction(TRIP_ID, DOC_ID, {
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
      ],
      // confidence: missing
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.formMessage).toBe('Please fix the highlighted fields.');
    expect(result.error.fields).toBeDefined();
    // Confidence is the missing key; it should show up in the field
    // map so the dialog can highlight it (or, since the dialog
    // doesn't render confidence, surface the formMessage banner).
    expect(result.error.fields?.confidence).toBeDefined();
    expect(mocks.updateParsed).not.toHaveBeenCalled();
  });

  it('happy path: writes the new payload and revalidates the trip', async () => {
    const doc = makeDocument({ parsed: VALID_BOARDING_PAYLOAD });
    mocks.updateParsed.mockResolvedValueOnce(doc);

    const result = await updateParsedAction(TRIP_ID, DOC_ID, VALID_BOARDING_PAYLOAD);

    expect(result).toEqual({ ok: true, value: { id: DOC_ID } });
    expect(mocks.updateParsed).toHaveBeenCalledTimes(1);
    expect(mocks.updateParsed).toHaveBeenCalledWith(
      USER.id,
      DOC_ID,
      expect.objectContaining({ kind: 'boarding-pass' }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/trips/${TRIP_ID}`, 'layout');
  });

  it('surfaces "Document not found." when the upfront cross-check fails', async () => {
    // The upfront cross-check runs getByIdForUser first; a missing
    // doc returns "Document not found." before updateParsed is even
    // called. (The error path's re-read still exists for the
    // post-write "doc was deleted between cross-check and predicate"
    // race; covered by the extraction-in-progress test below.)
    mocks.getByIdForUser.mockResolvedValueOnce(null);

    const result = await updateParsedAction(TRIP_ID, DOC_ID, VALID_BOARDING_PAYLOAD);

    expect(result).toEqual({ ok: false, error: { formMessage: 'Document not found.' } });
    expect(mocks.updateParsed).not.toHaveBeenCalled();
  });

  it('surfaces "extraction in progress" when the doc is mid-extract', async () => {
    // M6: predicate-update on documents.parsed includes
    // `extractionStartedAt IS NULL` so a stale dialog draft can't
    // clobber a freshly-cleared parsed during re-extract. The
    // action re-reads to distinguish "gone" from "in flight" and
    // surfaces a useful message. Both the upfront cross-check and
    // the post-write re-read see the same extracting doc.
    mocks.getByIdForUser.mockResolvedValue(
      makeDocument({ extractionStartedAt: new Date('2026-05-15T20:00:00Z') }),
    );
    mocks.updateParsed.mockResolvedValueOnce(null);

    const result = await updateParsedAction(TRIP_ID, DOC_ID, VALID_BOARDING_PAYLOAD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.formMessage).toMatch(/extraction is in progress/i);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteDocumentAction — cross-check rejection
// ---------------------------------------------------------------------------

describe('deleteDocumentAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(USER);
  });

  it('rejects when the supplied tripId does not match the document’s tripId', async () => {
    // Same defense-in-depth check as extractDocumentAction. The
    // hardDelete mock throws if called — its absence from the call
    // log proves the cross-check ran before the destructive op.
    mocks.getByIdForUser.mockResolvedValueOnce(makeDocument({ tripId: 'trip-other' }));

    const result = await deleteDocumentAction(TRIP_ID, DOC_ID);

    expect(result).toEqual({
      ok: false,
      error: { formMessage: 'Document does not belong to this trip.' },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
