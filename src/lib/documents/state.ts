// Derived state for the document lifecycle. Lives outside both the
// repo (which is DB-only) and the React tree (so the same logic can
// drive an RSC card, a polling decision in a page, and a future
// reaper job). All inputs are deterministic — no side effects, no
// hidden time captures: callers pass `now` so tests stay frozen.

import type { Document } from './repo';

/**
 * How long a non-null `documents.extractionStartedAt` stays "fresh"
 * before the UI demotes it to a stuck-job state. Picked to be longer
 * than any plausible Ollama-on-CPU extraction (worst observed: ~100s)
 * with comfortable headroom, but short enough that a Node crash
 * mid-job recovers within a coffee break.
 */
export const EXTRACTION_STALE_MS = 10 * 60 * 1000; // 10 minutes

export type ExtractionState = 'idle' | 'extracting' | 'extracted' | 'failed';

/**
 * Is the row's claim on the "extracting" slot still within the stale
 * window? `now` is parameterised so tests can pin a clock and so
 * callers fan-out the same `Date.now()` to multiple docs without
 * sampling time per element.
 */
export function isExtractionFresh(d: Document, now: number = Date.now()): boolean {
  if (!d.extractionStartedAt) return false;
  return now - d.extractionStartedAt.getTime() < EXTRACTION_STALE_MS;
}

/**
 * Collapse the row's persisted columns into a single lifecycle state.
 * Precedence:
 *   1. fresh `extractionStartedAt`           → 'extracting'
 *   2. `parsedBy` set                        → 'extracted'
 *   3. `extractionError` set                 → 'failed'
 *   4. stale `extractionStartedAt`, nothing else → 'failed' (stuck job)
 *   5. otherwise                             → 'idle'
 *
 * `now` defaults to `Date.now()` so callers in render code stay
 * terse; tests pin a fixed value to keep transitions deterministic.
 */
export function extractionState(d: Document, now: number = Date.now()): ExtractionState {
  if (isExtractionFresh(d, now)) return 'extracting';
  if (d.parsedBy) return 'extracted';
  if (d.extractionError) return 'failed';
  if (d.extractionStartedAt) return 'failed';
  return 'idle';
}
