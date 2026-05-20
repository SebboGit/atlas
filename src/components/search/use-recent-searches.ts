'use client';

import * as React from 'react';

const STORAGE_KEY = 'atlas:recent-searches:v1';
const MAX_ENTRIES = 8 as const;

// Deduplicate by lowercased value while preserving the first-seen
// (MRU) casing and order. A manual localStorage edit or a future
// migration could leave two entries that differ only in case; the
// React render keys them by string identity so a collision would
// trigger a key warning. Dedupe defensively on read so the rest of
// the module can rely on the invariant.
function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const strings = parsed.filter((v): v is string => typeof v === 'string');
    return dedupeCaseInsensitive(strings).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function write(values: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Quota or disabled storage — fall back to in-memory only.
  }
}

const EMPTY: string[] = [];
const listeners = new Set<() => void>();
// Cache the parsed snapshot so useSyncExternalStore sees a stable
// reference between renders (it bails out via Object.is). Without this
// every getSnapshot() call would return a new array and trigger an
// infinite render loop.
let snapshotCache: string[] | null = null;

function readSnapshot(): string[] {
  if (typeof window === 'undefined') return EMPTY;
  if (snapshotCache !== null) return snapshotCache;
  snapshotCache = read();
  return snapshotCache;
}

function publish(next: string[]): void {
  snapshotCache = next;
  write(next);
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  // Cross-tab sync — another tab updating the same key fires `storage`
  // on this window. Re-read so the list stays in sync.
  function onStorage(e: StorageEvent) {
    if (e.key !== STORAGE_KEY) return;
    snapshotCache = read();
    for (const l of listeners) l();
  }
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', onStorage);
  };
}

export function useRecentSearches() {
  const items = React.useSyncExternalStore(subscribe, readSnapshot, () => EMPTY);

  const push = React.useCallback((value: string) => {
    const q = value.trim();
    if (!q) return;
    const prev = readSnapshot();
    const next = [q, ...prev.filter((v) => v.toLowerCase() !== q.toLowerCase())].slice(
      0,
      MAX_ENTRIES,
    );
    publish(next);
  }, []);

  const clear = React.useCallback(() => {
    publish([]);
  }, []);

  return { items, push, clear };
}
