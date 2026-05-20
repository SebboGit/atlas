import { describe, expect, it } from 'vitest';

import { tripCreateInput, tripUpdateInput } from './validators';

describe('tripCreateInput', () => {
  it('accepts a minimal trip with just a title', () => {
    const result = tripCreateInput.safeParse({ title: 'Lisbon weekend' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Lisbon weekend');
      expect(result.data.status).toBe('planned');
      expect(result.data.summary).toBeNull();
      expect(result.data.startDate).toBeNull();
      expect(result.data.endDate).toBeNull();
    }
  });

  it('rejects an empty title', () => {
    const result = tripCreateInput.safeParse({ title: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects a title over 200 chars', () => {
    const result = tripCreateInput.safeParse({ title: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('coerces yyyy-mm-dd strings to Date', () => {
    const result = tripCreateInput.safeParse({
      title: 'Tokyo',
      startDate: '2026-06-01',
      endDate: '2026-06-10',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeInstanceOf(Date);
    }
  });

  it('normalises empty-string dates to null', () => {
    const result = tripCreateInput.safeParse({ title: 'x', startDate: '', endDate: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeNull();
      expect(result.data.endDate).toBeNull();
    }
  });

  it('rejects endDate before startDate', () => {
    const result = tripCreateInput.safeParse({
      title: 'x',
      startDate: '2026-06-10',
      endDate: '2026-06-01',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'endDate')).toBe(true);
    }
  });

  it('allows startDate without endDate (and vice versa)', () => {
    expect(tripCreateInput.safeParse({ title: 'x', startDate: '2026-06-01' }).success).toBe(true);
    expect(tripCreateInput.safeParse({ title: 'x', endDate: '2026-06-01' }).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = tripCreateInput.safeParse({ title: 'x', status: 'cancelled' });
    expect(result.success).toBe(false);
  });
});

describe('tripCreateInput round-trip', () => {
  // This is the regression for the client/server double-parse bug:
  // RHF parses the form, emits the OUTPUT shape, the server action
  // re-parses that output with the same schema. Every field must
  // accept its own output as valid input.
  it.each([
    { case: 'minimal', input: { title: 'Trip' } },
    {
      case: 'empty summary as string',
      input: { title: 'Trip', summary: '' },
    },
    {
      case: 'with both dates',
      input: { title: 'Trip', startDate: '2026-06-01', endDate: '2026-06-10' },
    },
    {
      case: 'every field set',
      input: {
        title: 'Trip',
        summary: 'A note',
        status: 'active' as const,
        startDate: '2026-06-01',
        endDate: '2026-06-10',
      },
    },
  ])('re-parses its own output: $case', ({ input }) => {
    const first = tripCreateInput.safeParse(input);
    expect(first.success).toBe(true);
    if (!first.success) return;
    const second = tripCreateInput.safeParse(first.data);
    expect(second.success).toBe(true);
  });
});

describe('tripUpdateInput', () => {
  it('accepts an empty object (no changes)', () => {
    expect(tripUpdateInput.safeParse({}).success).toBe(true);
  });

  it('still enforces date order on partial updates', () => {
    const result = tripUpdateInput.safeParse({
      startDate: '2026-06-10',
      endDate: '2026-06-01',
    });
    expect(result.success).toBe(false);
  });
});
