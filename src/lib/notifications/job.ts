// The `notify` job: every ntfy request Atlas makes goes through it and
// runs in the worker (ADR-0020). Callers enqueue and move on, so a slow
// or unreachable server never holds up a request, and only the worker
// container needs network reach to the ntfy host.
//
// The recipient's settings are read when the job RUNS, not when it is
// queued, so switching notifications off takes effect for anything
// still waiting in the queue.

import { getJobs, type SendOptions } from '@/lib/jobs';
import { log } from '@/lib/log';

import { deploymentTopic, getNotifier } from './index';
import type { DraftMessage } from './messages';
import type { NotificationCategory } from './prefs';
import { getNotificationSettings } from './repo';
import { resolveTopic } from './topic';
import type { NotificationPriority } from './types';

export const NOTIFY_JOB = 'notify';

export interface NotifyJobData extends DraftMessage {
  userId: string;
  /**
   * Which switch gates this message. `test` skips the switches — the
   * settings page's test button has to work before notifications are on.
   */
  category: NotificationCategory | 'test';
  priority?: NotificationPriority;
}

/** Thrown to hand a transient failure back to pg-boss for a retry. */
export class NotifyRetryableError extends Error {
  override name = 'NotifyRetryableError';
}

function errMessage(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : 'unknown';
}

/**
 * Queue a notification. Never throws: a notification is a convenience,
 * so a queueing failure is logged and the caller carries on. Resolves to
 * whether the job was queued.
 */
export async function enqueueNotification(
  data: NotifyJobData,
  opts?: SendOptions,
): Promise<boolean> {
  try {
    await getJobs().send(NOTIFY_JOB, data, opts);
    return true;
  } catch (err) {
    log.warn({ category: data.category, err: errMessage(err) }, 'notifications.enqueue_failed');
    return false;
  }
}

function clickUrl(path: string): string | undefined {
  const base = process.env.AUTH_URL?.trim();
  if (!base) return undefined;
  try {
    return new URL(path, base).toString();
  } catch {
    return undefined;
  }
}

export async function runNotifyJob(data: NotifyJobData): Promise<void> {
  const { userId, category } = data;
  const settings = await getNotificationSettings(userId);
  if (!settings) {
    log.info({ category }, 'notifications.skipped.user_missing');
    return;
  }
  if (category !== 'test' && (!settings.enabled || !settings.prefs[category])) {
    log.debug({ category }, 'notifications.skipped.opted_out');
    return;
  }
  const topic = resolveTopic(settings.topic, deploymentTopic());
  if (!topic) {
    log.info({ category }, 'notifications.skipped.no_topic');
    return;
  }

  // Everyone on the shared default topic sees what lands there, so a
  // message naming a private trip swaps to its trip-free body.
  const onSharedTopic = topic === deploymentTopic();
  const body = onSharedTopic && data.sharedTopicBody ? data.sharedTopicBody : data.body;

  const result = await getNotifier().notify({
    topic,
    title: data.title,
    body,
    tags: data.tags,
    priority: data.priority,
    click: clickUrl(data.path),
  });

  if (result.ok) {
    log.info({ category }, 'notifications.sent');
    return;
  }
  if (result.reason === 'unconfigured') {
    log.debug({ category }, 'notifications.skipped.unconfigured');
    return;
  }
  // A 4xx other than 429 is a setup problem — a wrong token, no write
  // access to the topic, a message the server refuses. Retrying sends
  // the same request to the same answer, so log it once and stop.
  const status = result.status;
  if (result.reason === 'rejected' && status !== undefined && status < 500 && status !== 429) {
    log.warn({ category, status }, 'notifications.rejected');
    return;
  }
  log.warn({ category, reason: result.reason, status }, 'notifications.send_failed');
  throw new NotifyRetryableError(`ntfy ${result.reason}${status ? ` (${status})` : ''}`);
}
