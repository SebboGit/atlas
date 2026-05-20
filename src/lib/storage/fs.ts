import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { fileTypeFromBuffer } from 'file-type';

import { DEFAULT_ALLOWED_MIMES, UNSNIFFABLE_MIMES as UNSNIFFABLE_LIST } from './mimes';
import { resolveSafe } from './path';
import {
  type PutOptions,
  type PutResult,
  type StatResult,
  type Storage,
  StorageNotFoundError,
  StorageRejectedError,
  type UrlOptions,
} from './types';

const MAGIC_SNIFF_BYTES = 4_100; // file-type recommends 4100 bytes.

// MIMEs `file-type` cannot identify by magic bytes alone. We allow them
// in only when the declared MIME matches one of these AND the file
// passes the matching structural validator. A blanket
// "trust the caller when file-type returns undefined" branch would
// let an attacker store arbitrary binary content under any
// declared MIME.
const UNSNIFFABLE_MIMES = new Set<string>(UNSNIFFABLE_LIST);

// Structural validators for unsniffable types. Each one peeks the
// already-collected sniff buffer; no extra I/O.
function isLikelyPkPass(buf: Buffer): boolean {
  // PKPass is a ZIP container — must start with PK\x03\x04.
  return (
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
  );
}

function isLikelyEml(buf: Buffer): boolean {
  // An RFC 5322 message starts with a header field. Require at least
  // one header line ending with a CRLF and a recognised header name.
  const head = buf.toString('utf8', 0, Math.min(buf.length, 1024));
  return /^(From|Received|Return-Path|Message-ID|Subject|To|Date):/im.test(head);
}

function validateUnsniffable(mime: string, buf: Buffer): boolean {
  switch (mime) {
    case 'application/vnd.apple.pkpass':
      return isLikelyPkPass(buf);
    case 'message/rfc822':
      return isLikelyEml(buf);
    default:
      return false;
  }
}

interface Config {
  rootDir: string;
  maxBytes: number;
  allowedMimes: Set<string>;
}

function configFromEnv(): Config {
  const rootDir = process.env.STORAGE_DIR;
  if (!rootDir) throw new Error('STORAGE_DIR is not set');

  const maxBytes = Number(process.env.STORAGE_MAX_BYTES ?? 20 * 1024 * 1024);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('STORAGE_MAX_BYTES must be a positive integer');
  }

  const allowedRaw = process.env.STORAGE_ALLOWED_MIMES;
  const allowedMimes = new Set(
    (allowedRaw ?? DEFAULT_ALLOWED_MIMES.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  return { rootDir, maxBytes, allowedMimes };
}

function makeKey(ext: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeExt = ext && ext.startsWith('.') ? ext.toLowerCase() : '';
  return `${yyyy}/${mm}/${randomUUID()}${safeExt}`;
}

function toNodeStream(source: ReadableStream<Uint8Array> | Buffer): NodeJS.ReadableStream {
  if (Buffer.isBuffer(source)) return Readable.from(source);
  return Readable.fromWeb(
    source as unknown as import('node:stream/web').ReadableStream<Uint8Array>,
  );
}

// Extension hint table for unsniffable MIMEs (file-type doesn't supply one).
const UNSNIFFABLE_EXT: Record<string, string> = {
  'application/vnd.apple.pkpass': '.pkpass',
  'message/rfc822': '.eml',
};

export class FilesystemStorage implements Storage {
  private readonly cfg: Config;

  constructor(cfg: Config = configFromEnv()) {
    this.cfg = cfg;
  }

  async put(source: ReadableStream<Uint8Array> | Buffer, opts: PutOptions): Promise<PutResult> {
    if (opts.size > this.cfg.maxBytes) {
      throw new StorageRejectedError(
        `file exceeds STORAGE_MAX_BYTES (${this.cfg.maxBytes})`,
        'too-large',
      );
    }

    const input = toNodeStream(source);

    const sniffChunks: Buffer[] = [];
    let sniffed = 0;
    const hash = crypto.createHash('sha256');
    let totalBytes = 0;

    // Write to a tmp file in the root dir, then rename atomically. This
    // way no partial files appear under YYYY/MM/ on crash.
    const tmpName = `.tmp-${randomUUID()}`;
    const tmpAbs = path.join(path.resolve(this.cfg.rootDir), tmpName);
    await fs.mkdir(path.dirname(tmpAbs), { recursive: true });
    const out = createWriteStream(tmpAbs);

    try {
      await pipeline(
        input,
        async function* (src) {
          for await (const chunk of src) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += buf.length;
            hash.update(buf);
            if (sniffed < MAGIC_SNIFF_BYTES) {
              const need = MAGIC_SNIFF_BYTES - sniffed;
              sniffChunks.push(buf.subarray(0, need));
              sniffed += Math.min(need, buf.length);
            }
            yield buf;
          }
        },
        out,
      );

      if (totalBytes > this.cfg.maxBytes) {
        throw new StorageRejectedError(
          `file exceeds STORAGE_MAX_BYTES (${this.cfg.maxBytes})`,
          'too-large',
        );
      }

      const sniffBuf = Buffer.concat(sniffChunks);
      // ONE call to file-type. Reuse the result for the mismatch check
      // and the extension lookup.
      const ft = sniffBuf.length > 0 ? await fileTypeFromBuffer(sniffBuf) : undefined;

      let detectedMime: string;
      let ext: string;

      if (UNSNIFFABLE_MIMES.has(opts.declaredMime)) {
        // Unsniffable types take a different path. file-type may either
        // not recognise them at all (PKPass before it gets unzipped, or
        // EML), or it may identify the CONTAINER format only — a PKPass
        // is a ZIP and file-type rightly reports `application/zip`. We
        // defer to the structural validator instead of treating either
        // case as a mismatch.
        if (!validateUnsniffable(opts.declaredMime, sniffBuf)) {
          throw new StorageRejectedError(
            `MIME ${opts.declaredMime} structural validation failed`,
            'mime-mismatch',
          );
        }
        detectedMime = opts.declaredMime;
        ext = UNSNIFFABLE_EXT[opts.declaredMime] ?? opts.extHint ?? '';
      } else if (ft) {
        // Sniffable types: trust the bytes.
        detectedMime = ft.mime;
        ext = `.${ft.ext}`;
        if (detectedMime !== opts.declaredMime) {
          throw new StorageRejectedError(
            `declared MIME ${opts.declaredMime} does not match detected ${detectedMime}`,
            'mime-mismatch',
          );
        }
      } else {
        // file-type returned undefined and declared isn't on the
        // unsniffable allow-list. Refuse — this is the "claim image/png
        // and smuggle arbitrary bytes" hole.
        throw new StorageRejectedError(
          `MIME ${opts.declaredMime} could not be verified by magic bytes`,
          'mime-mismatch',
        );
      }

      if (!this.cfg.allowedMimes.has(detectedMime)) {
        throw new StorageRejectedError(
          `MIME type not allowed: ${detectedMime}`,
          'mime-not-allowed',
        );
      }

      const key = makeKey(ext);
      const finalAbs = resolveSafe(this.cfg.rootDir, key);
      await fs.mkdir(path.dirname(finalAbs), { recursive: true });
      await fs.rename(tmpAbs, finalAbs);

      return {
        key,
        sha256: hash.digest('hex'),
        mime: detectedMime,
        bytes: totalBytes,
      };
    } catch (err) {
      await fs.rm(tmpAbs, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  async get(key: string): Promise<ReadableStream<Uint8Array>> {
    const abs = resolveSafe(this.cfg.rootDir, key);
    try {
      await fs.access(abs);
    } catch {
      throw new StorageNotFoundError(key);
    }
    return Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream<Uint8Array>;
  }

  async stat(key: string): Promise<StatResult> {
    const abs = resolveSafe(this.cfg.rootDir, key);
    try {
      const st = await fs.stat(abs);
      return { size: st.size, mime: 'application/octet-stream', createdAt: st.birthtime };
    } catch {
      throw new StorageNotFoundError(key);
    }
  }

  async delete(key: string): Promise<void> {
    const abs = resolveSafe(this.cfg.rootDir, key);
    await fs.rm(abs, { force: true });
  }

  url(_key: string, _opts?: UrlOptions): string {
    // Document downloads are addressed by Document.id, not by storage
    // key — see /api/documents/[id]. The repo layer knows the mapping;
    // callers should construct the URL there. This method exists only
    // to satisfy the Storage interface and intentionally throws so a
    // future caller fails loudly instead of producing a 404 URL.
    throw new Error(
      'Storage.url() is not implemented — look up by Document.id and use /api/documents/<id>.',
    );
  }
}
