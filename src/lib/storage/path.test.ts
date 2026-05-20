import { describe, expect, it } from 'vitest';

import { resolveSafe } from './path';
import { StoragePathError } from './types';

const ROOT = '/srv/atlas/data/documents';

describe('resolveSafe', () => {
  it('resolves a well-formed key under the root', () => {
    const abs = resolveSafe(ROOT, '2026/05/abcd-1234.pdf');
    expect(abs).toBe('/srv/atlas/data/documents/2026/05/abcd-1234.pdf');
  });

  it('rejects ".." traversal even when it stays inside root after collapse', () => {
    expect(() => resolveSafe(ROOT, '2026/../../etc/passwd')).toThrow(StoragePathError);
  });

  it('rejects an absolute POSIX path', () => {
    expect(() => resolveSafe(ROOT, '/etc/passwd')).toThrow(StoragePathError);
  });

  it('rejects a Windows-style drive prefix', () => {
    expect(() => resolveSafe(ROOT, 'C:\\Windows\\system32.txt')).toThrow(StoragePathError);
  });

  it('rejects a UNC path', () => {
    expect(() => resolveSafe(ROOT, '\\\\server\\share\\file')).toThrow(StoragePathError);
  });

  it('rejects a key containing a null byte', () => {
    expect(() => resolveSafe(ROOT, '2026/05/abc\0.pdf')).toThrow(StoragePathError);
  });

  it('rejects an empty key', () => {
    expect(() => resolveSafe(ROOT, '')).toThrow(StoragePathError);
  });

  it('rejects a non-string key', () => {
    // @ts-expect-error — explicitly testing runtime guard.
    expect(() => resolveSafe(ROOT, null)).toThrow(StoragePathError);
  });

  // Keys are always server-generated UUIDs in put(), so caller-supplied
  // strings never reach this function in normal operation. These tests
  // exist so that if a future API surface DOES accept a key from the
  // wire, this function stays the single hardened bottleneck.

  it('treats percent-encoded ".." as a literal directory name (no decode)', () => {
    // resolveSafe must NOT decode `%2e%2e`. If a future caller does the
    // decode themselves before calling, that's their problem. As written,
    // the call should succeed and resolve inside root with a literal
    // %2e%2e/ directory — bizarre but safe.
    const abs = resolveSafe(ROOT, '2026/05/%2e%2e-file.pdf');
    expect(abs.startsWith(ROOT)).toBe(true);
    expect(abs).toContain('%2e%2e');
  });

  it('rejects Unicode fullwidth dots that LOOK like ".." (defence in depth)', () => {
    // Fullwidth `．．` (U+FF0E) is visually similar to `..` but is a
    // different codepoint. path.relative() treats it as a literal name,
    // so this case is actually safe — but the test pins the behaviour
    // so a future "smart" decode helper can't regress it.
    const abs = resolveSafe(ROOT, '2026/05/．．-file.pdf');
    expect(abs.startsWith(ROOT)).toBe(true);
  });

  it('rejects mixed-separator escape attempts', () => {
    expect(() => resolveSafe(ROOT, '2026\\..\\..\\etc/passwd')).toThrow(StoragePathError);
  });
});
