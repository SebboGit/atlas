// The capability feature code depends on. One implementation today
// (`ntfy.ts`); a different push service would be a sibling file and a
// change in `index.ts`, never a change at a call site (ADR-0020).

/** ntfy's 1–5 scale: 1 min, 3 default, 5 urgent. */
export type NotificationPriority = 1 | 2 | 3 | 4 | 5;

export interface NotificationMessage {
  /** Destination topic. Resolved from the user's settings, never typed by feature code. */
  topic: string;
  /** Short headline. Kept well under the server's size limits. */
  title: string;
  /** One or two short lines. Never PNRs, passport numbers or document text. */
  body: string;
  priority?: NotificationPriority;
  /** ntfy tags. Emoji shortcodes render as an icon beside the title. */
  tags?: string[];
  /** Absolute URL opened when the notification is tapped. */
  click?: string;
}

export type NotifyResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * `unconfigured`: no server set, nothing was attempted.
       * `rejected`: the server answered with an error status (bad token, no
       * write access to the topic, message too large).
       * `unreachable`: network failure or timeout.
       */
      reason: 'unconfigured' | 'rejected' | 'unreachable';
      status?: number;
    };

export interface Notifier {
  /** Never throws. A failure comes back as a result for the caller to log or retry. */
  notify(message: NotificationMessage): Promise<NotifyResult>;
  /** True when the server answers its health endpoint. Never throws. */
  healthy(): Promise<boolean>;
}
