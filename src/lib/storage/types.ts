// Storage interface and tagged errors. See src/lib/storage/README.md and
// docs/adr/0001-local-filesystem-storage.md for the contract and rationale.

export interface PutOptions {
  /** Claimed MIME type from the upload. Verified against magic bytes; reject if it doesn't match. */
  declaredMime: string;
  /** Declared size in bytes. Enforced against STORAGE_MAX_BYTES while streaming. */
  size: number;
  /** Optional filename hint — used only to derive an extension as a fallback. */
  extHint?: string;
}

export interface PutResult {
  /** Storage key: `<yyyy>/<mm>/<uuid><ext>`. Never user-influenced. */
  key: string;
  /** SHA-256 of the file contents, lowercase hex. */
  sha256: string;
  /** MIME type confirmed by magic bytes. */
  mime: string;
  /** Bytes actually written. */
  bytes: number;
}

export interface StatResult {
  size: number;
  mime: string;
  createdAt: Date;
}

export interface UrlOptions {
  disposition?: 'inline' | 'attachment';
  filename?: string;
}

export interface Storage {
  put(source: ReadableStream<Uint8Array> | Buffer, opts: PutOptions): Promise<PutResult>;

  get(key: string): Promise<ReadableStream<Uint8Array>>;

  stat(key: string): Promise<StatResult>;

  /** Idempotent — does not throw if the key is already gone. */
  delete(key: string): Promise<void>;

  /** Returns an internal app URL (e.g. `/api/documents/<id>`). Never a presigned external URL. */
  url(key: string, opts?: UrlOptions): string;
}

// ---- Tagged errors ----

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export class StoragePathError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = 'StoragePathError';
  }
}

export class StorageRejectedError extends StorageError {
  constructor(
    message: string,
    public readonly reason: 'mime-mismatch' | 'mime-not-allowed' | 'too-large',
  ) {
    super(message);
    this.name = 'StorageRejectedError';
  }
}

export class StorageNotFoundError extends StorageError {
  constructor(key: string) {
    super(`storage key not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}
