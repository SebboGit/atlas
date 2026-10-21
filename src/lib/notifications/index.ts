// Entry point for push notifications (ADR-0020). Feature code imports
// from here — `getNotifier()`, the job helpers, the topic and prefs
// helpers — never from `ntfy.ts` directly.
//
// Env contract:
// - NTFY_URL   — server base URL. Empty disables notifications entirely.
// - NTFY_TOPIC — deployment default topic; a user may override it.
// - NTFY_TOKEN — access token, needed when the server denies by default.

import { NtfyNotifier } from './ntfy';
import type { Notifier } from './types';

export type { NotificationMessage, NotificationPriority, Notifier, NotifyResult } from './types';
export {
  notificationPrefsSchema,
  parseNotificationPrefs,
  type NotificationCategory,
  type NotificationPrefs,
} from './prefs';
export { isValidTopic, resolveTopic, TOPIC_PATTERN } from './topic';

const noopNotifier: Notifier = {
  async notify() {
    return { ok: false, reason: 'unconfigured' };
  },
  async healthy() {
    return false;
  },
};

let instance: Notifier | null = null;

/** True when a server is configured. The settings page shows setup state from this. */
export function notificationsConfigured(): boolean {
  return Boolean(process.env.NTFY_URL?.trim());
}

/** The deployment default topic, or null when none is set. */
export function deploymentTopic(): string | null {
  return process.env.NTFY_TOPIC?.trim() || null;
}

export function getNotifier(): Notifier {
  if (!instance) {
    const baseUrl = process.env.NTFY_URL?.trim();
    instance = baseUrl
      ? new NtfyNotifier({ baseUrl, token: process.env.NTFY_TOKEN })
      : noopNotifier;
  }
  return instance;
}

export function __resetNotifierForTests(): void {
  instance = null;
}
