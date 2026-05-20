// Background work seam.
//
// The single method `enqueue` accepts a thunk and decides when/how to
// run it. The caller captures whatever context it needs in the closure
// (user id, payload, ids); the Jobs layer doesn't model jobs as
// first-class entities — it doesn't need to today, and ADR-thresholds
// (CLAUDE.md → Extension Points) say not to pre-build BullMQ + Redis.
//
// Implementations MUST NOT throw out of `enqueue` itself — scheduling
// is best-effort. Errors raised by the work function MUST be caught and
// logged inside the implementation; the caller has already returned by
// the time the work runs.

export interface Jobs {
  /**
   * Schedule `work` to run in the background, after the current call
   * stack unwinds and the server action's response is sent. Returns
   * synchronously — no job id, no status tracking. State that needs
   * to survive the request belongs on the relevant domain row (e.g.
   * `documents.extractionStartedAt`).
   */
  enqueue(work: () => Promise<void>): void;
}
