import { FilesystemStorage } from './fs';
import type { Storage } from './types';

export type { PutOptions, PutResult, StatResult, Storage, UrlOptions } from './types';
export {
  StorageError,
  StorageNotFoundError,
  StoragePathError,
  StorageRejectedError,
} from './types';

let _storage: Storage | undefined;

/**
 * Resolve the configured Storage implementation. Today only the
 * filesystem backend exists. When (if) S3 / WebDAV are added, select
 * based on `STORAGE_BACKEND` env here and keep the interface identical.
 */
export function getStorage(): Storage {
  if (!_storage) _storage = new FilesystemStorage();
  return _storage;
}
