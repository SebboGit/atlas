# Storage adapter

Atlas documents live on the **local filesystem**. All file I/O goes through this folder.

> **Why filesystem and not S3/MinIO?** See [`docs/adr/0001-local-filesystem-storage.md`](../../../docs/adr/0001-local-filesystem-storage.md).

## Contract

The adapter exposes one interface; today's implementation is `fs.ts`. Feature code imports the interface, never the implementation, so a future swap to `s3.ts` is a one-line change.

```ts
export interface Storage {
  /**
   * Stream a file into storage.
   * - Generates a random key: <yyyy>/<mm>/<uuid><ext>
   * - Computes SHA-256 inline; never reads the file twice.
   * - Validates MIME via magic bytes (rejects mismatched `opts.mime`).
   * - Enforces STORAGE_MAX_BYTES.
   */
  put(
    source: ReadableStream | Buffer,
    opts: { declaredMime: string; size: number; extHint?: string },
  ): Promise<{ key: string; sha256: string; mime: string; bytes: number }>;

  /** Stream a file out of storage. Throws StorageNotFoundError if missing. */
  get(key: string): Promise<ReadableStream>;

  /** Metadata only — no file body. */
  stat(key: string): Promise<{ size: number; mime: string; createdAt: Date }>;

  /** Remove a file. Idempotent. */
  delete(key: string): Promise<void>;

  /**
   * Returns an INTERNAL APP URL (not a presigned external URL).
   * Authentication and authorisation happen in the route handler.
   */
  url(key: string, opts?: { disposition?: 'inline' | 'attachment'; filename?: string }): string;
}
```

## Implementation rules (for `fs.ts`)

1. **Path safety, always.**
   - All keys are resolved relative to `STORAGE_DIR` via `path.resolve` + a check that the resolved path is still inside `STORAGE_DIR`.
   - Reject any key containing `..`, absolute paths (starting with `/` or a drive letter), or null bytes.
   - There are unit tests for this. Don't delete them.

2. **Never trust the caller's filename.** The original filename is metadata stored on the `Document` row. On disk we use `<yyyy>/<mm>/<uuid><ext>`, where `ext` is derived from the validated MIME, not the upload's filename.

3. **Stream, don't buffer.** `put` and `get` are streaming. Memory usage must be independent of file size.

4. **Validate MIME with magic bytes.** Use `file-type` to read the first few KB of the stream. If detected MIME doesn't match `opts.declaredMime` or isn't in `STORAGE_ALLOWED_MIMES`, reject before writing the file.

5. **Atomic writes.** Write to a `*.tmp` file in the same directory, then `rename` into place. No partial files on disk on crash.

6. **No-op delete on missing.** `delete` doesn't throw if the file is gone — the `Document` row may have been the last reference.

7. **`url()` returns app-relative paths only.** Something like `/api/documents/<id>?disposition=inline`. The actual file path on disk is never exposed in URLs.

## Future implementations

When (if) the assumption changes, add a sibling file:

- `s3.ts` — AWS S3 or any S3-compatible service. Adds presigned URLs.
- `webdav.ts` — an offsite store via WebDAV. Probably not worth the latency for primary storage; consider for cold/archived docs instead.

The interface stays identical. Wire selection in `index.ts` based on an env var when more than one exists.
