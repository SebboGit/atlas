import { describe, expect, it } from 'vitest';

import { err, isErr, isOk, ok, type Result } from './result';

describe('Result', () => {
  it('ok narrows in a type-guard branch', () => {
    const r: Result<number, string> = ok(42);
    if (isOk(r)) {
      expect(r.value).toBe(42);
    } else {
      throw new Error('expected ok');
    }
  });

  it('err narrows in a type-guard branch', () => {
    const r: Result<number, string> = err('nope');
    if (isErr(r)) {
      expect(r.error).toBe('nope');
    } else {
      throw new Error('expected err');
    }
  });
});
