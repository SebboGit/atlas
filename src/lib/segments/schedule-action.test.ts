// Tests for the quick reschedule actions — scheduleSegmentAction /
// unscheduleSegmentAction. Trust-boundary guarantees:
//
//   - Only activity and food segments can be (un)scheduled here; any
//     other type is rejected before the repo is touched, so a crafted
//     request can't restamp a flight / hotel / transit / note.
//   - The verified existing row's type is passed through to the repo
//     (which pins it in its WHERE), never a client-supplied value.
//   - A wall-clock string with no timezone is interpreted at UTC
//     (floating local time, ADR-0014), so a reschedule never shifts the
//     typed time.
//
// Mocking shape mirrors flight-legs-action.test.ts — vi.hoisted, repo +
// auth + revalidatePath mocked, actions imported afterwards.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Segment } from '@/db/schema';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getByIdForUser: vi.fn(),
  scheduleSegment: vi.fn(),
  unscheduleSegment: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ requireUser: mocks.requireUser }));
vi.mock('./repo', () => ({
  getByIdForUser: mocks.getByIdForUser,
  scheduleSegment: mocks.scheduleSegment,
  unscheduleSegment: mocks.unscheduleSegment,
  // Stubs for the rest of the module's repo imports so it loads.
  getTripForUser: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  hardDelete: vi.fn(),
  listFlightLegGroup: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock('@/lib/trips/repo', () => ({ getByIdForUser: vi.fn() }));
vi.mock('@/lib/geocoding', () => ({ geocodeOnSegmentChange: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/db/client', () => ({ db: {} }));

import { scheduleSegmentAction, unscheduleSegmentAction } from './actions';

const USER = { id: 'user-1' };

function row(type: Segment['type'], id = 'seg-1'): Segment {
  return { id, type, tripId: 'trip-1' } as unknown as Segment;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
});

describe('scheduleSegmentAction', () => {
  it('schedules an activity, passing its verified type to the repo', async () => {
    mocks.getByIdForUser.mockResolvedValue(row('activity'));
    mocks.scheduleSegment.mockResolvedValue(row('activity'));

    const result = await scheduleSegmentAction('trip-1', 'seg-1', { startsAt: '2025-10-07' });

    expect(result.ok).toBe(true);
    expect(mocks.scheduleSegment).toHaveBeenCalledTimes(1);
    const [userId, id, type] = mocks.scheduleSegment.mock.calls[0]!;
    expect(userId).toBe('user-1');
    expect(id).toBe('seg-1');
    expect(type).toBe('activity');
  });

  it('schedules a food segment too', async () => {
    mocks.getByIdForUser.mockResolvedValue(row('food'));
    mocks.scheduleSegment.mockResolvedValue(row('food'));

    const result = await scheduleSegmentAction('trip-1', 'seg-1', { startsAt: '2025-10-07T19:30' });

    expect(result.ok).toBe(true);
    expect(mocks.scheduleSegment.mock.calls[0]![2]).toBe('food');
  });

  it('interprets a typed wall-clock at UTC (floating local time)', async () => {
    mocks.getByIdForUser.mockResolvedValue(row('food'));
    mocks.scheduleSegment.mockResolvedValue(row('food'));

    await scheduleSegmentAction('trip-1', 'seg-1', { startsAt: '2025-10-07T19:30' });

    const startsAt = mocks.scheduleSegment.mock.calls[0]![3] as Date;
    expect(startsAt.toISOString()).toBe('2025-10-07T19:30:00.000Z');
  });

  it('rejects a non-schedulable type without touching the repo', async () => {
    mocks.getByIdForUser.mockResolvedValue(row('flight'));

    const result = await scheduleSegmentAction('trip-1', 'seg-1', { startsAt: '2025-10-07' });

    expect(result.ok).toBe(false);
    expect(mocks.scheduleSegment).not.toHaveBeenCalled();
  });

  it('errors when the segment is not found', async () => {
    mocks.getByIdForUser.mockResolvedValue(null);

    const result = await scheduleSegmentAction('trip-1', 'seg-1', { startsAt: '2025-10-07' });

    expect(result.ok).toBe(false);
    expect(mocks.scheduleSegment).not.toHaveBeenCalled();
  });

  it('rejects a missing date', async () => {
    mocks.getByIdForUser.mockResolvedValue(row('activity'));

    const result = await scheduleSegmentAction('trip-1', 'seg-1', { startsAt: '' });

    expect(result.ok).toBe(false);
  });
});

describe('unscheduleSegmentAction', () => {
  it('clears an activity date, passing its verified type to the repo', async () => {
    mocks.getByIdForUser.mockResolvedValue(row('activity'));
    mocks.unscheduleSegment.mockResolvedValue(row('activity'));

    const result = await unscheduleSegmentAction('trip-1', 'seg-1');

    expect(result.ok).toBe(true);
    expect(mocks.unscheduleSegment).toHaveBeenCalledWith('user-1', 'seg-1', 'activity');
  });

  it('rejects a non-schedulable type without touching the repo', async () => {
    mocks.getByIdForUser.mockResolvedValue(row('hotel'));

    const result = await unscheduleSegmentAction('trip-1', 'seg-1');

    expect(result.ok).toBe(false);
    expect(mocks.unscheduleSegment).not.toHaveBeenCalled();
  });
});
