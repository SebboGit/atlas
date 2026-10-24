import { describe, expect, it } from 'vitest';

import { isUuid } from './uuid';

describe('isUuid', () => {
  it('accepts a v7 id as Atlas mints them, in either case', () => {
    expect(isUuid('01929b4c-7c3e-7a51-9f2e-3b1c5d6e7f80')).toBe(true);
    expect(isUuid('01929B4C-7C3E-7A51-9F2E-3B1C5D6E7F80')).toBe(true);
  });

  it('rejects what would reach Postgres as an invalid uuid', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid('01929b4c-7c3e-7a51-9f2e-3b1c5d6e7f8')).toBe(false);
    expect(isUuid('01929b4c7c3e7a519f2e3b1c5d6e7f80')).toBe(false);
  });
});
