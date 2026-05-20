// Tests for the multi-leg flight edit actions.
//
//   - updateFlightLegsAction: atomic batch update for sibling flight
//     segments edited together in the dialog. Trust-boundary
//     guarantees: every leg must be a flight, every existing row must
//     be owned by the caller and live on the supplied trip, and a
//     mid-transaction row miss must surface as a clean error rather
//     than a leaked exception.
//
//   - loadFlightLegGroupAction: sibling discovery for the dialog's
//     opening fetch. Non-flight segments short-circuit to a singleton
//     so the dialog renders the standard single-segment form.
//
// Mocking shape mirrors `update-action.test.ts` — vi.hoisted, repo +
// auth + revalidatePath mocked, actions imported afterwards.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Segment } from '@/db/schema';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getByIdForUser: vi.fn(),
  listFlightLegGroup: vi.fn(),
  updateMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ requireUser: mocks.requireUser }));
vi.mock('./repo', () => ({
  getByIdForUser: mocks.getByIdForUser,
  listFlightLegGroup: mocks.listFlightLegGroup,
  updateMany: mocks.updateMany,
  // The other actions in the module import these too; provide stubs
  // so the module loads without exploding.
  update: vi.fn(),
  hardDelete: vi.fn(),
  scheduleActivity: vi.fn(),
  unscheduleActivity: vi.fn(),
  create: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/db/client', () => ({ db: {} }));

import { loadFlightLegGroupAction, updateFlightLegsAction } from './actions';

const USER = { id: 'user-1' } as const;
const TRIP_ID = 'trip-aaa';
// Valid v4 UUIDs — Zod's `.uuid()` enforces the version + variant
// nibbles, so the all-zeros placeholder we used at first was rejected
// at the schema seam before any of the action-layer checks ran.
const SEG_A = '11111111-1111-4111-8111-111111111111';
const SEG_B = '22222222-2222-4222-8222-222222222222';

function makeFlightSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: SEG_A,
    tripId: TRIP_ID,
    type: 'flight',
    data: { carrier: 'BA', flightNumber: '287' },
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

function validFlightInput() {
  return {
    type: 'flight',
    data: { carrier: 'BA', flightNumber: '287' },
    startsAt: '2026-06-01',
    endsAt: null,
    locationName: null,
    countryCode: null,
    originCountryCode: null,
  };
}

// ---------------------------------------------------------------------------
// updateFlightLegsAction
// ---------------------------------------------------------------------------

describe('updateFlightLegsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(USER);
  });

  it('propagates the auth failure when requireUser throws', async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(
      updateFlightLegsAction(TRIP_ID, {
        legs: [{ id: SEG_A, input: validFlightInput() }],
      }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an empty legs array as a schema error', async () => {
    const result = await updateFlightLegsAction(TRIP_ID, { legs: [] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.formMessage).toBe('Please fix the highlighted fields.');
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a non-flight leg type with a per-leg field error', async () => {
    const result = await updateFlightLegsAction(TRIP_ID, {
      legs: [
        { id: SEG_A, input: validFlightInput() },
        {
          id: SEG_B,
          input: {
            type: 'hotel',
            data: { propertyName: 'Sneaky' },
            startsAt: '2026-06-01',
            endsAt: '2026-06-02',
            locationName: null,
            countryCode: null,
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.fields?.['legs.1.input.type']).toBeDefined();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('returns "Segment not found." when one of the legs is not owned', async () => {
    mocks.getByIdForUser
      .mockResolvedValueOnce(makeFlightSegment({ id: SEG_A }))
      .mockResolvedValueOnce(null);

    const result = await updateFlightLegsAction(TRIP_ID, {
      legs: [
        { id: SEG_A, input: validFlightInput() },
        { id: SEG_B, input: validFlightInput() },
      ],
    });

    expect(result).toEqual({ ok: false, error: { formMessage: 'Segment not found.' } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a leg living on a different trip', async () => {
    mocks.getByIdForUser.mockResolvedValueOnce(makeFlightSegment({ tripId: 'other-trip' }));

    const result = await updateFlightLegsAction(TRIP_ID, {
      legs: [{ id: SEG_A, input: validFlightInput() }],
    });

    expect(result).toEqual({
      ok: false,
      error: { formMessage: 'Segment does not belong to this trip.' },
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stored row whose type does not match the incoming leg type', async () => {
    // Stored row is hotel; incoming says flight. The earlier "all
    // legs must be flight" check passes; this catches the
    // server-side type-drift trust check.
    mocks.getByIdForUser.mockResolvedValueOnce(
      makeFlightSegment({ type: 'hotel' as Segment['type'] }),
    );

    const result = await updateFlightLegsAction(TRIP_ID, {
      legs: [{ id: SEG_A, input: validFlightInput() }],
    });

    expect(result).toEqual({
      ok: false,
      error: { formMessage: 'Segment type cannot be changed after creation.' },
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('happy path: forwards all legs to repo.updateMany and revalidates the trip', async () => {
    mocks.getByIdForUser
      .mockResolvedValueOnce(makeFlightSegment({ id: SEG_A }))
      .mockResolvedValueOnce(makeFlightSegment({ id: SEG_B }));
    mocks.updateMany.mockResolvedValueOnce([
      makeFlightSegment({ id: SEG_A }),
      makeFlightSegment({ id: SEG_B }),
    ]);

    const result = await updateFlightLegsAction(TRIP_ID, {
      legs: [
        { id: SEG_A, input: validFlightInput() },
        { id: SEG_B, input: validFlightInput() },
      ],
    });

    expect(result).toEqual({ ok: true, value: { ids: [SEG_A, SEG_B] } });
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      USER.id,
      expect.arrayContaining([
        expect.objectContaining({ id: SEG_A }),
        expect.objectContaining({ id: SEG_B }),
      ]),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/trips/${TRIP_ID}`, 'layout');
  });

  it('surfaces per-leg `data` validation failures at the dotted path the dialog expects', async () => {
    // The dialog strips `legs.${i}.input.` from server field-error
    // keys before passing them to the active tab's field components.
    // Pin the path shape here so a future Zod-issue-flattening change
    // (or a discriminator restructure) doesn't silently break the
    // round-trip.
    const result = await updateFlightLegsAction(TRIP_ID, {
      legs: [
        {
          id: SEG_A,
          input: {
            ...validFlightInput(),
            data: {
              // Length 5 fails `.length(3)` on originAirport.
              originAirport: 'TOOLONG',
            },
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.error.fields ?? {})).toContain('legs.0.input.data.originAirport');
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('translates a mid-transaction TOCTOU into a clean error', async () => {
    // Pre-check passes (both legs exist + owned + matching type), but
    // the transaction's UPDATE hits zero rows for one of them — the
    // user deleted that segment in another tab between pre-check and
    // the batch UPDATE. The repo throws SEGMENT_NOT_FOUND; the action
    // must surface it as the friendly form-level error rather than
    // letting it propagate.
    mocks.getByIdForUser
      .mockResolvedValueOnce(makeFlightSegment({ id: SEG_A }))
      .mockResolvedValueOnce(makeFlightSegment({ id: SEG_B }));
    mocks.updateMany.mockRejectedValueOnce(new Error('SEGMENT_NOT_FOUND'));

    const result = await updateFlightLegsAction(TRIP_ID, {
      legs: [
        { id: SEG_A, input: validFlightInput() },
        { id: SEG_B, input: validFlightInput() },
      ],
    });

    expect(result).toEqual({ ok: false, error: { formMessage: 'Segment not found.' } });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// loadFlightLegGroupAction
// ---------------------------------------------------------------------------

describe('loadFlightLegGroupAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(USER);
  });

  it('propagates the auth failure when requireUser throws', async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(loadFlightLegGroupAction(TRIP_ID, SEG_A)).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.listFlightLegGroup).not.toHaveBeenCalled();
  });

  it('returns "Segment not found." when the segment is not owned', async () => {
    mocks.getByIdForUser.mockResolvedValueOnce(null);

    const result = await loadFlightLegGroupAction(TRIP_ID, SEG_A);

    expect(result).toEqual({ ok: false, error: { formMessage: 'Segment not found.' } });
    expect(mocks.listFlightLegGroup).not.toHaveBeenCalled();
  });

  it('rejects a segment living on a different trip', async () => {
    mocks.getByIdForUser.mockResolvedValueOnce(makeFlightSegment({ tripId: 'other-trip' }));

    const result = await loadFlightLegGroupAction(TRIP_ID, SEG_A);

    expect(result).toEqual({
      ok: false,
      error: { formMessage: 'Segment does not belong to this trip.' },
    });
    expect(mocks.listFlightLegGroup).not.toHaveBeenCalled();
  });

  it('returns a singleton for non-flight segments without calling the sibling lookup', async () => {
    const self = makeFlightSegment({ type: 'hotel' as Segment['type'] });
    mocks.getByIdForUser.mockResolvedValueOnce(self);

    const result = await loadFlightLegGroupAction(TRIP_ID, SEG_A);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([self]);
    expect(mocks.listFlightLegGroup).not.toHaveBeenCalled();
  });

  it('happy path: returns the sibling group from the repo', async () => {
    const self = makeFlightSegment({ id: SEG_A });
    const sibling = makeFlightSegment({ id: SEG_B });
    mocks.getByIdForUser.mockResolvedValueOnce(self);
    mocks.listFlightLegGroup.mockResolvedValueOnce([self, sibling]);

    const result = await loadFlightLegGroupAction(TRIP_ID, SEG_A);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.map((s) => s.id)).toEqual([SEG_A, SEG_B]);
  });

  it('falls back to a singleton when the repo returns an empty group', async () => {
    // Defensive — `listFlightLegGroup` should always include the
    // segment itself, but if it ever returns [] the action must
    // still produce a renderable result.
    const self = makeFlightSegment({ id: SEG_A });
    mocks.getByIdForUser.mockResolvedValueOnce(self);
    mocks.listFlightLegGroup.mockResolvedValueOnce([]);

    const result = await loadFlightLegGroupAction(TRIP_ID, SEG_A);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([self]);
  });
});
