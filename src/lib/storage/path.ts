import path from 'node:path';

import { StoragePathError } from './types';

const NULL_BYTE = '\0';

/**
 * Resolve a caller-supplied key under STORAGE_DIR and refuse anything
 * fishy: traversal, absolute paths, null bytes, or paths that resolve
 * outside the root. The single bottleneck for path safety.
 */
export function resolveSafe(rootDir: string, key: string): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new StoragePathError('storage key is empty');
  }
  if (key.includes(NULL_BYTE)) {
    throw new StoragePathError('storage key contains a null byte');
  }
  if (path.isAbsolute(key)) {
    throw new StoragePathError('storage key must be relative');
  }
  // Reject Windows-style absolute paths and UNC paths even on POSIX hosts
  // — defence in depth in case STORAGE_DIR ever lands on a non-POSIX host.
  if (/^[a-zA-Z]:[\\/]/.test(key) || key.startsWith('\\\\')) {
    throw new StoragePathError('storage key has a drive or UNC prefix');
  }
  // Reject any backslash anywhere in the key. Server-generated keys never
  // contain one; a caller-supplied key with `\` is either a Windows-style
  // separator (a separator on Windows hosts) or an attempt to confuse a
  // future cross-platform deployment. No legitimate use case.
  if (key.includes('\\')) {
    throw new StoragePathError('storage key contains a backslash');
  }

  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, key);

  // Must be inside root. Use `path.relative` to catch escape sequences
  // that `path.resolve` already collapsed.
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new StoragePathError('storage key escapes the storage root');
  }

  return resolved;
}
