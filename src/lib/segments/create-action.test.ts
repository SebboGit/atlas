// Tests for createSegmentAction.
//
// The action layer is the trust boundary for manual segment entry.
// Beyond the usual auth + validation guarantees, this pins the
// ADR-0008 behaviour added for issue #23: a manually-created segment
// whose date falls outside the trip's ±2 day window is flagged
// `needsReview`, mirroring what the document-extraction bridge does —
// so the advisory chip is no longer extraction-only.
//
// Mocking conventions match `update-action.test.ts` — vi.hoisted +
// vi.mock the repo and side-effect modules, import the action AFTER
// the mocks land. The real `isWithinTripWindow` runs (date-window is
// not mocked), so the mocked trip's dates drive the assertions.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Segment, Trip } from '@/db/schema';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  create: vi.fn(),
  revalidatePath: vi.fn(),
  geocodeOnSegmentChange: vi.fn(),
  getTripForUser: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ requireUser: mocks.requireUser }));
vi.mock('./repo', () => ({ create: mocks.create }));
vi.mock('@/lib/trips/repo', () => ({ getByIdForUser: mocks.getTripForUser }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/geocoding', () => ({
  geocodeOnSegmentChange: mocks.geocodeOnSegmentChange,
}));
vi.mock('@/db/client', () => ({ db: {} }));

import { createSegmentAction } from './actions';

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

// Default window contains the 2026-06-01 input date → in-window.
function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    userId: USER.id,
    title: 'Japan',
    summary: null,
    status: 'planned',
    startDate: new Date(2026, 4, 30),
    endDate: new Date(2026, 5, 10),
    createdAt: new Date('2026-05-01'),
    updatedAt: new Date('2026-05-01'),
    searchText: null,
    searchTsv: null,
    ...overrides,
  } as Trip;
}

describe('createSegmentAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(USER);
    mocks.getTripForUser.mockResolvedValue(makeTrip());
    mocks.create.mockResolvedValue(makeFlightSegment());
  });

  it('propagates the auth failure when requireUser throws', async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(createSegmentAction(TRIP_ID, validFlightInput())).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('returns flattened field errors on schema validation failure', async () => {
    const result = await createSegmentAction(TRIP_ID, {
      ...validFlightInput(),
      type: 'not-a-real-type',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.formMessage).toBe('Please fix the highlighted fields.');
    expect(result.error.fields).toBeDefined();
    // Trip lookup and write are both skipped on a parse failure.
    expect(mocks.getTripForUser).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('returns "Trip not found." when the trip is not owned by the user', async () => {
    mocks.getTripForUser.mockResolvedValueOnce(null);

    const result = await createSegmentAction(TRIP_ID, validFlightInput());

    expect(result).toEqual({ ok: false, error: { formMessage: 'Trip not found.' } });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('happy path: in-window date writes the segment with needsReview=false', async () => {
    const result = await createSegmentAction(TRIP_ID, validFlightInput());

    expect(result).toEqual({ ok: true, value: { id: SEG_ID } });
    expect(mocks.create).toHaveBeenCalledWith(
      USER.id,
      TRIP_ID,
      expect.objectContaining({ type: 'flight' }),
      { needsReview: false },
    );
    expect(mocks.geocodeOnSegmentChange).toHaveBeenCalledWith({ segment: makeFlightSegment() });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/trips/${TRIP_ID}`, 'layout');
  });

  it('flags needsReview when the manual date falls outside the trip window', async () => {
    // The issue scenario: an 11–18 Jun trip, a flight manually dated
    // outside the window. The advisory must fire on manual entry, not
    // only on extraction.
    mocks.getTripForUser.mockResolvedValueOnce(
      makeTrip({ startDate: new Date(2026, 5, 11), endDate: new Date(2026, 5, 18) }),
    );

    const result = await createSegmentAction(TRIP_ID, {
      ...validFlightInput(),
      startsAt: '2026-06-21',
    });

    expect(result).toEqual({ ok: true, value: { id: SEG_ID } });
    expect(mocks.create).toHaveBeenCalledWith(
      USER.id,
      TRIP_ID,
      expect.objectContaining({ type: 'flight' }),
      { needsReview: true },
    );
  });

  it('does NOT flag an undated segment (wishlist) even on a dated trip', async () => {
    // isWithinTripWindow returns true for a null eventDate, so an
    // undated activity never carries the advisory.
    const result = await createSegmentAction(TRIP_ID, {
      type: 'activity',
      data: { title: 'Maybe: teamLab' },
      startsAt: null,
      endsAt: null,
      locationName: null,
      countryCode: null,
    });

    expect(result.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(
      USER.id,
      TRIP_ID,
      expect.objectContaining({ type: 'activity' }),
      { needsReview: false },
    );
  });

  it('does NOT flag a dated segment on a wishlist trip (null trip dates)', async () => {
    // isWithinTripWindow returns true when either trip date is null
    // (ADR-0003 wishlist trips have no window), so even a far-future
    // date carries no advisory — there's nothing to be outside of.
    mocks.getTripForUser.mockResolvedValueOnce(makeTrip({ startDate: null, endDate: null }));

    const result = await createSegmentAction(TRIP_ID, {
      ...validFlightInput(),
      startsAt: '2030-01-01',
    });

    expect(result.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(
      USER.id,
      TRIP_ID,
      expect.objectContaining({ type: 'flight' }),
      { needsReview: false },
    );
  });

  it('translates a TRIP_NOT_FOUND race from repo.create into a clean error', async () => {
    // Trip existed at the window-check fetch but was deleted before the
    // insert. repo.create throws; the action surfaces the friendly form
    // error rather than a 500.
    mocks.create.mockRejectedValueOnce(new Error('TRIP_NOT_FOUND'));

    const result = await createSegmentAction(TRIP_ID, validFlightInput());

    expect(result).toEqual({ ok: false, error: { formMessage: 'Trip not found.' } });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
