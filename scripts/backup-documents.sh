#!/usr/bin/env bash
# =============================================================================
# Atlas — Documents backup (host-side)
#
# The Postgres database is backed up by the `db-backup` container
# (nfrastack/container-db-backup), which writes ZSTD-compressed dumps to
# ./data/backups/db/ on its own schedule.
#
# This script's job is to capture the *documents* directory into the same
# snapshot tree, so a single rsync to your offsite location captures
# everything stateful.
#
# Suggested cron (host):
#   30 3 * * *  cd /opt/atlas && ./scripts/backup-documents.sh
#   (Run shortly after the db-backup container's 03:30 dump completes.)
#
# Env:
#   BACKUP_DIR     Where to write snapshots (default: ./data/backups/documents)
#   DOCUMENTS_DIR  Where uploaded files live on the host (default: ./data/documents)
#   RETENTION_DAYS Delete snapshots older than this (default: 30)
# =============================================================================
set -euo pipefail

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_DIR:-./data/backups/documents}"
DOCUMENTS_DIR="${DOCUMENTS_DIR:-./data/documents}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TARGET="${BACKUP_DIR}/${TIMESTAMP}"

mkdir -p "${BACKUP_DIR}"

if [[ ! -d "${DOCUMENTS_DIR}" ]]; then
  echo "ERROR: ${DOCUMENTS_DIR} does not exist — nothing to back up."
  exit 1
fi

echo "→ Mirroring documents directory..."
# -a archive, -H preserve hardlinks. No --delete: each snapshot is independent.
rsync -aH "${DOCUMENTS_DIR}/" "${TARGET}/"

echo "→ Writing manifest..."
{
  echo "Atlas documents snapshot ${TIMESTAMP}"
  echo "Source: ${DOCUMENTS_DIR}"
  echo "Files:  $(find "${TARGET}" -type f | wc -l | tr -d ' ')"
  echo "Size:   $(du -sh "${TARGET}" | cut -f1)"
} > "${TARGET}/MANIFEST.txt"

echo "→ Pruning snapshots older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" \
  -exec echo "  removing {}" \; -exec rm -rf {} \;

echo "→ Done: ${TARGET}"
