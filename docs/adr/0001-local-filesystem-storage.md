# ADR-0001: Local filesystem for document storage

- **Status:** Accepted
- **Date:** 2026-05-13
- **Deciders:** @SebboGit

## Context

Atlas needs to store user-uploaded documents: PDFs (boarding passes, hotel confirmations), images (scanned receipts), PKPass files, and emails. The storage layer needs to support:

- Streaming uploads and downloads (PDFs can be multi-MB).
- Integrity verification (SHA-256 of content).
- Random, non-guessable keys for stored files.
- Authenticated access (no public URLs).
- A clear backup story.
- Future extensibility if the app ever grows beyond a single user.

The original design proposed **MinIO** (a self-hosted S3-compatible object store) for this role. On reflection, MinIO is solving problems Atlas does not have.

### Forces

- **Scale.** Single user. Realistic upper bound: low tens of GB of documents over a decade. Object stores shine at scale; Atlas has none.
- **Operational surface.** MinIO adds a second stateful service to run, monitor, back up, and version. Each is a failure mode in a homelab where the operator is also the user.
- **Backup story.** Postgres dump + MinIO bucket mirror is two coordinated artifacts. Postgres dump + an `rsync` of a directory is one.
- **Tooling fit.** The target deployment already uses bind mounts and rsync-based backups to offsite storage. A directory on disk drops into that flow with zero new tooling.
- **Reversibility.** If the assumption ever breaks (multi-user, multi-host, very large library), swapping in S3/MinIO behind the storage adapter interface is a one-file change.
- **DX in dev.** No bucket-init container, no MinIO console, no S3 client config. `ls data/documents/` and you see your files.

## Decision

Store documents on the **local filesystem** at `STORAGE_DIR` (default `/app/data/documents`), bind-mounted into the app container.

All file I/O happens through a `Storage` interface in `src/lib/storage/`. The default implementation is `fs.ts`, using `node:fs/promises` and `node:stream`. Feature code MUST NOT import the adapter implementation directly — only the `Storage` interface.

Document downloads are served via an authenticated route handler (`/api/documents/[id]`) that streams the file with hardened headers. The data directory is never exposed by the reverse proxy.

## Consequences

### Positive

- One backup target instead of two. `pg_dump` + `rsync data/documents/` and you're done.
- Zero extra services to operate.
- Trivial dev experience — files are visible on the host.
- Streaming reads/writes via Node's native APIs are fast and memory-bounded.
- Pairs naturally with the existing homelab pattern of a bind-mounted directory rsync'd to an offsite target.

### Negative / tradeoffs

- No native presigned URLs. Every download proxies through the Next.js process. For a single user with infrequent doc views, this cost is negligible — but it means the app process is on the read path. (Mitigated: streams, not buffers.)
- No multi-host scale-out. If the app ever needs to run on more than one node, this needs to change. (Mitigated: storage adapter interface.)
- Filesystem-level concerns become app concerns: free space, inode exhaustion, permissions. A simple disk-space alert on the host is sufficient.
- Path-traversal becomes an attack surface the app must defend against. The storage adapter MUST reject keys containing `..`, absolute paths, or null bytes, and resolve all paths relative to `STORAGE_DIR`. This is testable and tested.

### Neutral

- File integrity via SHA-256 is computed during streaming `put` regardless of backend, so the verification story is unchanged.
- The `Document` row is the source of truth for "what files exist." Orphan files on disk are swept periodically.

## Alternatives considered

- **MinIO.** Rejected: extra service, extra backup target, extra failure mode, zero benefit at this scale.
- **Postgres BLOBs.** Rejected: bloats the database, complicates dumps, awkward for multi-MB PDFs.
- **WebDAV/SFTP offsite storage as primary store.** Rejected: latency on every read, network as a hard dependency. Better as the backup target, which it already is.
- **SeaweedFS / Garage.** Rejected: lighter than MinIO but still extra services for no real benefit.

## References

- `CLAUDE.md` → "Storage (Documents)" section
- `src/lib/storage/` — the adapter (to be implemented)
- `docker-compose.yml` — bind mount on the `app` service

## Revisit if

- A second user is added to the app.
- The app moves to a multi-node deployment.
- Document library grows past ~500GB or starts hurting filesystem performance.
