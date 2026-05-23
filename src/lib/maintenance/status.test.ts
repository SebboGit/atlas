import { describe, expect, it } from 'vitest';

import { classifyTransition, startOfDayUtc } from './status';

const today = new Date('2026-05-23T00:00:00Z');
const yesterday = new Date('2026-05-22T00:00:00Z');
const tomorrow = new Date('2026-05-24T00:00:00Z');
const lastMonth = new Date('2026-04-23T00:00:00Z');
const nextMonth = new Date('2026-06-23T00:00:00Z');

describe('classifyTransition — planned → active', () => {
  it('activates a trip whose start has arrived and end is in the future', () => {
    expect(
      classifyTransition({ status: 'planned', startDate: yesterday, endDate: tomorrow }, today),
    ).toBe('active');
  });

  it('activates a trip starting today', () => {
    expect(
      classifyTransition({ status: 'planned', startDate: today, endDate: tomorrow }, today),
    ).toBe('active');
  });

  it('activates a trip ending today (last-day trips count)', () => {
    expect(
      classifyTransition({ status: 'planned', startDate: yesterday, endDate: today }, today),
    ).toBe('active');
  });

  it('activates an open-ended trip (null endDate) once the start has arrived', () => {
    expect(
      classifyTransition({ status: 'planned', startDate: yesterday, endDate: null }, today),
    ).toBe('active');
  });

  it('leaves a future-start trip alone', () => {
    expect(
      classifyTransition({ status: 'planned', startDate: tomorrow, endDate: nextMonth }, today),
    ).toBeNull();
  });

  it('leaves a wishlist trip (null startDate) alone forever', () => {
    expect(
      classifyTransition({ status: 'planned', startDate: null, endDate: null }, today),
    ).toBeNull();
  });

  it('does not activate a planned trip whose end has already passed (jumps straight to completed eligibility next sweep)', () => {
    // A 'planned' trip with an already-past endDate is a data oddity.
    // We deliberately do not activate it — the next iteration's
    // 'active → completed' would not fire either (status is still
    // 'planned'). Leaving it alone surfaces the oddity in the UI
    // rather than papering over it.
    expect(
      classifyTransition({ status: 'planned', startDate: lastMonth, endDate: yesterday }, today),
    ).toBeNull();
  });
});

describe('classifyTransition — active → completed', () => {
  it('completes a trip whose endDate is in the past', () => {
    expect(
      classifyTransition({ status: 'active', startDate: lastMonth, endDate: yesterday }, today),
    ).toBe('completed');
  });

  it('does not complete a trip ending today (still on the trip today)', () => {
    expect(
      classifyTransition({ status: 'active', startDate: yesterday, endDate: today }, today),
    ).toBeNull();
  });

  it('does not complete a trip with no endDate (open-ended stays active)', () => {
    expect(
      classifyTransition({ status: 'active', startDate: lastMonth, endDate: null }, today),
    ).toBeNull();
  });

  it('does not complete a trip ending in the future', () => {
    expect(
      classifyTransition({ status: 'active', startDate: yesterday, endDate: tomorrow }, today),
    ).toBeNull();
  });
});

describe('classifyTransition — terminal states', () => {
  it('never moves a completed trip, even if endDate is now in the future (user edit)', () => {
    expect(
      classifyTransition({ status: 'completed', startDate: yesterday, endDate: nextMonth }, today),
    ).toBeNull();
  });

  it('never moves an archived trip', () => {
    expect(
      classifyTransition({ status: 'archived', startDate: yesterday, endDate: tomorrow }, today),
    ).toBeNull();
  });
});

// These tests lock in the mid-day-clock fix: a sweep that fires at
// any time during a trip's last day must treat that day as still
// in-progress, not as past. Without the start-of-day-UTC truncation,
// the planned→active activation predicate fails for trips ending
// today (endDate < now), and the active→completed predicate
// prematurely succeeds.
describe('classifyTransition — wall-clock independence', () => {
  const midDayUtc = new Date('2026-05-23T14:00:00Z');
  const earlyMorningUtc = new Date('2026-05-23T00:05:00Z');
  const justBeforeMidnight = new Date('2026-05-23T23:59:59Z');

  for (const now of [midDayUtc, earlyMorningUtc, justBeforeMidnight]) {
    it(`activates a planned trip whose only day is today (now=${now.toISOString()})`, () => {
      expect(classifyTransition({ status: 'planned', startDate: today, endDate: today }, now)).toBe(
        'active',
      );
    });

    it(`does NOT complete an active trip whose last day is today (now=${now.toISOString()})`, () => {
      expect(
        classifyTransition({ status: 'active', startDate: yesterday, endDate: today }, now),
      ).toBeNull();
    });
  }
});

describe('startOfDayUtc', () => {
  it('truncates a wall-clock instant to UTC midnight of the same day', () => {
    expect(startOfDayUtc(new Date('2026-05-23T14:37:42.123Z')).toISOString()).toBe(
      '2026-05-23T00:00:00.000Z',
    );
  });

  it('is idempotent — a midnight input returns itself', () => {
    expect(startOfDayUtc(new Date('2026-05-23T00:00:00Z')).toISOString()).toBe(
      '2026-05-23T00:00:00.000Z',
    );
  });
});
