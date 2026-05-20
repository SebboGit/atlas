// Tests for updateSegmentAction.
//
// The action layer is the trust boundary for segment edits. Two
// guarantees worth pinning:
//   1. Type cannot change post-creation (server-side defence; the
//      form locks it client-side).
//   2. Validation failures surface as field-level errors the form
//      can render against specific inputs.
//
// Mocking conventions match `documents/actions.test.ts` — vi.hoisted
// + vi.mock the repo and side-effect modules, import the action
// AFTER the mocks land.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Segment } from '@/db/schema';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getByIdForUser: vi.fn(),
  update: vi.fn(),
  revalidatePath: vi.fn(),
  geocodeOnSegmentChange: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ requireUser: mocks.requireUser }));
vi.mock('./repo', () => ({
  getByIdForUser: mocks.getByIdForUser,
  update: mocks.update,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/geocoding', () => ({
  geocodeOnSegmentChange: mocks.geocodeOnSegmentChange,
}));
vi.mock('@/db/client', () => ({ db: {} }));

import { updateSegmentAction } from './actions';

const USER = { id: 'user-1' } as const;
const TRIP_ID = 'trip-aaa';
const SEG_ID = 'seg-bbb';

function makeFlightSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: SEG_ID,
    tripId: TRIP_ID,
    type: 'flight',
    data: { carrier: 'BA', flightNumber: '287' },
    startsAt: new Date(2026, 5, 1),
    endsAt: null,
    locationName: 'SFO',
    countryCode: null,
    originCountryCode: null,
    needsReview: false,
    createdAt: new Date('2026-05-01'),
    updatedAt: new Date('2026-05-01'),
    ...overrides,
  } as Segment;
}

// Valid flight input matching segmentCreateInput's discriminated-union
// shape. Carries a non-empty data block so the .strict() flightData
// validator is happy.
function validFlightInput() {
  return {
    type: 'flight',
    data: { carrier: 'BA', flightNumber: '287' },
    startsAt: '2026-06-01',
    endsAt: null,
    locationName: 'SFO',
    countryCode: null,
    originCountryCode: null,
  };
}

describe('updateSegmentAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(USER);
  });

  it('propagates the auth failure when requireUser throws', async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(updateSegmentAction(TRIP_ID, SEG_ID, validFlightInput())).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns flattened field errors on schema validation failure', async () => {
    // Invalid: type is "flight" but data is missing required-form
    // structure (the data block is empty {} which IS valid because
    // flightData has no required fields). Trip a different rule:
    // pass an invalid type discriminator.
    const result = await updateSegmentAction(TRIP_ID, SEG_ID, {
      ...validFlightInput(),
      type: 'not-a-real-type',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.formMessage).toBe('Please fix the highlighted fields.');
    expect(result.error.fields).toBeDefined();
    // No update should have run.
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns "Segment not found." when the segment is not owned by the user', async () => {
    mocks.getByIdForUser.mockResolvedValueOnce(null);

    const result = await updateSegmentAction(TRIP_ID, SEG_ID, validFlightInput());

    expect(result).toEqual({ ok: false, error: { formMessage: 'Segment not found.' } });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('REJECTS a type change as a server-side trust boundary', async () => {
    // The form locks type in edit mode, but a crafted request could
    // still try to flip the discriminator. Server must refuse —
    // changing type would orphan data and break the row's invariants.
    mocks.getByIdForUser.mockResolvedValueOnce(makeFlightSegment());

    const result = await updateSegmentAction(TRIP_ID, SEG_ID, {
      type: 'hotel',
      data: { propertyName: 'Sneaky Hotel' },
      startsAt: '2026-06-01',
      endsAt: '2026-06-02',
      locationName: null,
      countryCode: null,
    });

    expect(result).toEqual({
      ok: false,
      error: { formMessage: 'Segment type cannot be changed after creation.' },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('happy path: writes the update and revalidates the trip', async () => {
    const existing = makeFlightSegment();
    const updated = makeFlightSegment({ updatedAt: new Date('2026-05-15') });
    mocks.getByIdForUser.mockResolvedValueOnce(existing);
    mocks.update.mockResolvedValueOnce(updated);

    const result = await updateSegmentAction(TRIP_ID, SEG_ID, validFlightInput());

    expect(result).toEqual({ ok: true, value: { id: SEG_ID } });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(
      USER.id,
      SEG_ID,
      expect.objectContaining({ type: 'flight' }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/trips/${TRIP_ID}`, 'layout');
    // Geocode hook receives both rows so it can compare the derived
    // query (per-type — propertyName + address for hotels, title for
    // activities, etc.) and skip the fetch when nothing geocodable
    // changed.
    expect(mocks.geocodeOnSegmentChange).toHaveBeenCalledWith({
      segment: updated,
      prior: existing,
    });
  });

  it('returns "Segment not found." when repo.update returns null (TOCTOU)', async () => {
    // Type-check passed, but the segment was deleted between the
    // getByIdForUser and the UPDATE. Translate to a clean error
    // instead of pretending success.
    mocks.getByIdForUser.mockResolvedValueOnce(makeFlightSegment());
    mocks.update.mockResolvedValueOnce(null);

    const result = await updateSegmentAction(TRIP_ID, SEG_ID, validFlightInput());

    expect(result).toEqual({ ok: false, error: { formMessage: 'Segment not found.' } });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
