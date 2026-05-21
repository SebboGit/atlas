'use client';

import * as React from 'react';

// Per-trip persistence for the collapsed-past-days itinerary.
//
// Why localStorage and not URL state: the default open/closed state of
// the combined past group is fixed (collapsed), so it needs no
// persistence at all. What *does* need persisting is the user's manual
// override — "I expanded the past span to check what we did" — and that
// is incidental UI preference, not shareable application state. Putting
// it in the URL would clutter every itinerary link with collapse flags
// and collide with the chronological-map work (issue #9), which
// reserves the query string for timeline position. localStorage keeps
// the URL clean and the override survives navigation and reloads.
//
// Storage shape: one key per trip, value is a JSON map of
// group-key -> boolean, where `true` means "expanded" and `false`
// means "collapsed". The itinerary has a single collapsible region
// (the combined past group, keyed `"past"`), so the map carries at
// most one entry — and only once the user has *explicitly* toggled it.
// Everything else falls back to the default, so the persisted blob
// stays tiny. The map shape is kept (rather than a bare boolean) so the
// hook stays reusable if a second collapsible region is ever added.
//
// State is read via `useSyncExternalStore` so the server snapshot is an
// empty override map (pure defaults) and the client snapshot reads
// localStorage — this keeps the first paint identical to the SSR markup
// and avoids a hydration mismatch without a setState-in-effect.

const STORAGE_PREFIX = 'atlas:itinerary-collapse:';

type OverrideMap = Record<string, boolean>;

const EMPTY_OVERRIDES: OverrideMap = {};

function storageKey(tripId: string): string {
  return `${STORAGE_PREFIX}${tripId}`;
}

function parseOverrides(raw: string | null): OverrideMap {
  if (!raw) return EMPTY_OVERRIDES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: OverrideMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'boolean') out[k] = v;
      }
      return out;
    }
  } catch {
    // Corrupt JSON — fall back to defaults. Collapse state is a
    // convenience, never load-bearing.
  }
  return EMPTY_OVERRIDES;
}

function writeOverrides(tripId: string, overrides: OverrideMap): void {
  if (typeof window === 'undefined') return;
  try {
    const key = storageKey(tripId);
    if (Object.keys(overrides).length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(overrides));
    }
  } catch {
    // Best-effort persistence — ignore quota / private-mode failures.
  }
}

// `useSyncExternalStore` requires a stable snapshot reference between
// renders when nothing changed, otherwise it loops. We cache the last
// parsed map per trip and only re-parse when the raw string differs;
// `writeOverrides` bumps a counter to notify subscribers.
interface StoreCache {
  raw: string | null;
  value: OverrideMap;
}
const storeCaches = new Map<string, StoreCache>();
const subscribers = new Map<string, Set<() => void>>();

function notify(tripId: string): void {
  subscribers.get(tripId)?.forEach((fn) => fn());
}

function subscribe(tripId: string, onChange: () => void): () => void {
  let set = subscribers.get(tripId);
  if (!set) {
    set = new Set();
    subscribers.set(tripId, set);
  }
  set.add(onChange);
  // Cross-tab edits: a `storage` event fires in *other* tabs only, so
  // a second window viewing the same trip stays in sync.
  const onStorage = (e: StorageEvent) => {
    if (e.key === storageKey(tripId)) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    set?.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(tripId: string): OverrideMap {
  // `localStorage.getItem` can throw in restricted-storage contexts
  // (Safari private mode, storage disabled). A throwing `getSnapshot`
  // breaks `useSyncExternalStore`, so fall back to `null` — pure
  // defaults — on any failure. (The write path in `writeOverrides`
  // is already guarded the same way.)
  let raw: string | null = null;
  if (typeof window !== 'undefined') {
    try {
      raw = window.localStorage.getItem(storageKey(tripId));
    } catch {
      raw = null;
    }
  }
  const cached = storeCaches.get(tripId);
  if (cached && cached.raw === raw) return cached.value;
  const value = parseOverrides(raw);
  storeCaches.set(tripId, { raw, value });
  return value;
}

// Server render and the very first client paint both use this — pure
// defaults, no localStorage — so the markup matches across the boundary.
function getServerSnapshot(): OverrideMap {
  return EMPTY_OVERRIDES;
}

export interface ItineraryCollapse {
  // Whether a given collapsible group renders expanded. `defaultExpanded`
  // is the group's default (the combined past group passes `false`); a
  // stored override wins over it when present.
  isExpanded: (groupKey: string, defaultExpanded: boolean) => boolean;
  // Records a manual toggle and persists it.
  toggle: (groupKey: string, defaultExpanded: boolean) => void;
}

export function useItineraryCollapse(tripId: string): ItineraryCollapse {
  const subscribeForTrip = React.useCallback(
    (onChange: () => void) => subscribe(tripId, onChange),
    [tripId],
  );
  const snapshotForTrip = React.useCallback(() => getSnapshot(tripId), [tripId]);

  const overrides = React.useSyncExternalStore(
    subscribeForTrip,
    snapshotForTrip,
    getServerSnapshot,
  );

  const isExpanded = React.useCallback(
    (groupKey: string, defaultExpanded: boolean): boolean => {
      const override = overrides[groupKey];
      return override ?? defaultExpanded;
    },
    [overrides],
  );

  const toggle = React.useCallback(
    (groupKey: string, defaultExpanded: boolean) => {
      const current = overrides[groupKey] ?? defaultExpanded;
      const flipped = !current;
      const next: OverrideMap = { ...overrides };
      // When a toggle lands the group back on its default, drop the
      // override entirely so the map stays minimal and the group can
      // resume tracking its default later.
      if (flipped === defaultExpanded) {
        delete next[groupKey];
      } else {
        next[groupKey] = flipped;
      }
      writeOverrides(tripId, next);
      // Invalidate the cache so the next getSnapshot returns `next`,
      // then notify subscribers in this tab to re-render.
      storeCaches.delete(tripId);
      notify(tripId);
    },
    [overrides, tripId],
  );

  return { isExpanded, toggle };
}
