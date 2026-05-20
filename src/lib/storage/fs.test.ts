import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FilesystemStorage } from './fs';
import { StorageNotFoundError, StorageRejectedError } from './types';

// Minimal valid PDF (header + EOF) — file-type recognises it as
// application/pdf.
const MINIMAL_PDF = Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.from('1 0 obj\n<<>>\nendobj\n'),
  Buffer.from('trailer<<>>\n%%EOF\n'),
]);

describe('FilesystemStorage', () => {
  let rootDir: string;
  let storage: FilesystemStorage;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'atlas-storage-'));
    storage = new FilesystemStorage({
      rootDir,
      maxBytes: 1_000_000,
      allowedMimes: new Set(['application/pdf']),
    });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('writes a buffer, returns a key with the YYYY/MM prefix, and computes sha256', async () => {
    const result = await storage.put(MINIMAL_PDF, {
      declaredMime: 'application/pdf',
      size: MINIMAL_PDF.length,
    });

    expect(result.mime).toBe('application/pdf');
    expect(result.bytes).toBe(MINIMAL_PDF.length);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);

    const abs = path.join(rootDir, result.key);
    const onDisk = await readFile(abs);
    expect(onDisk.equals(MINIMAL_PDF)).toBe(true);
  });

  it('rejects when declared MIME disagrees with magic bytes', async () => {
    await expect(
      storage.put(MINIMAL_PDF, {
        declaredMime: 'image/png',
        size: MINIMAL_PDF.length,
      }),
    ).rejects.toBeInstanceOf(StorageRejectedError);
  });

  it('rejects when detected MIME is not on the allow-list', async () => {
    const restricted = new FilesystemStorage({
      rootDir,
      maxBytes: 1_000_000,
      allowedMimes: new Set(['image/png']),
    });

    await expect(
      restricted.put(MINIMAL_PDF, {
        declaredMime: 'application/pdf',
        size: MINIMAL_PDF.length,
      }),
    ).rejects.toBeInstanceOf(StorageRejectedError);
  });

  it('rejects files larger than maxBytes (declared)', async () => {
    const small = new FilesystemStorage({
      rootDir,
      maxBytes: 10,
      allowedMimes: new Set(['application/pdf']),
    });

    await expect(
      small.put(MINIMAL_PDF, {
        declaredMime: 'application/pdf',
        size: MINIMAL_PDF.length,
      }),
    ).rejects.toBeInstanceOf(StorageRejectedError);
  });

  it('round-trips a stored file via get()', async () => {
    const { key } = await storage.put(MINIMAL_PDF, {
      declaredMime: 'application/pdf',
      size: MINIMAL_PDF.length,
    });

    const readStream = await storage.get(key);
    const chunks: Uint8Array[] = [];
    const reader = readStream.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const read = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    expect(read.equals(MINIMAL_PDF)).toBe(true);
  });

  it('get() throws StorageNotFoundError for an unknown key', async () => {
    await expect(storage.get('2026/05/does-not-exist.pdf')).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
  });

  it('delete() is a no-op when the file is already gone', async () => {
    await expect(storage.delete('2026/05/never-existed.pdf')).resolves.toBeUndefined();
  });

  it('PKPass: accepts when content starts with the ZIP magic (PK\\x03\\x04)', async () => {
    const pkpassStorage = new FilesystemStorage({
      rootDir,
      maxBytes: 1_000_000,
      allowedMimes: new Set(['application/vnd.apple.pkpass']),
    });
    // Minimal PKPass: ZIP local file header magic + nothing else.
    const fake = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const result = await pkpassStorage.put(fake, {
      declaredMime: 'application/vnd.apple.pkpass',
      size: fake.length,
    });
    expect(result.mime).toBe('application/vnd.apple.pkpass');
    expect(result.key).toMatch(/\.pkpass$/);
  });

  it('PKPass: rejects bytes that do NOT start with the ZIP magic', async () => {
    const pkpassStorage = new FilesystemStorage({
      rootDir,
      maxBytes: 1_000_000,
      allowedMimes: new Set(['application/vnd.apple.pkpass']),
    });
    const fake = Buffer.from('this-is-not-a-zip-file', 'utf8');
    await expect(
      pkpassStorage.put(fake, {
        declaredMime: 'application/vnd.apple.pkpass',
        size: fake.length,
      }),
    ).rejects.toBeInstanceOf(StorageRejectedError);
  });

  it('Unsniffable bypass closed: arbitrary bytes claiming "image/png" without magic are rejected', async () => {
    // file-type returns undefined for a few random bytes; image/png is
    // NOT on the unsniffable list, so the put should fail.
    const arb = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    await expect(
      storage.put(arb, {
        declaredMime: 'image/png',
        size: arb.length,
      }),
    ).rejects.toBeInstanceOf(StorageRejectedError);
  });

  it('url() throws — callers must use /api/documents/<id>', () => {
    expect(() => storage.url('2026/05/abcd.pdf')).toThrow(/not implemented/);
  });

  it('writes via a tmp file then renames (no partial files visible)', async () => {
    const { key } = await storage.put(MINIMAL_PDF, {
      declaredMime: 'application/pdf',
      size: MINIMAL_PDF.length,
    });
    const finalStat = await stat(path.join(rootDir, key));
    expect(finalStat.isFile()).toBe(true);

    // The temp file should not survive a successful put.
    const yearDir = path.join(rootDir, key.split('/')[0] ?? '');
    const monthDir = path.join(rootDir, key.split('/').slice(0, 2).join('/'));
    for (const dir of [rootDir, yearDir, monthDir]) {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(dir);
      expect(entries.some((e) => e.startsWith('.tmp-'))).toBe(false);
    }
  });
});
