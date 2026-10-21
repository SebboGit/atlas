// The `notify` job: every ntfy request Atlas makes goes through it and
// runs in the worker (ADR-0020). Callers enqueue and move on, so a slow
// or unreachable server never holds up a request, and only the worker
// container needs network reach to the ntfy host.
//
// Two shapes. A user message (document reading, the test send) names a
// user, whose settings are read when the job RUNS, so switching
// notifications off takes effect for anything still waiting in the
// queue. A reminder names a topic and a delivery row: the reminder sweep
// already chose the recipients and the wording, and the job records how
// the send went on that row.

import { getJobs, type SendOptions, type SendResult } from '@/lib/jobs';
import { log } from '@/lib/log';

import { deploymentTopic, getNotifier } from './index';
import type { DraftMessage } from './messages';
import type { NotificationCategory } from './prefs';
import { getNotificationSettings, markDelivery } from './repo';
import { resolveTopic } from './topic';
import type { NotificationMessage, NotificationPriority } from './types';

export const NOTIFY_JOB = 'notify';
/**
 * Reminders get their own queue so it can deduplicate: it is created with
 * pg-boss's `'short'` policy (at most one waiting job per key) and each
 * send is keyed by its delivery row. The sweep re-queues a row that has
 * sat `queued` for ten minutes; if the first job is in fact still waiting
 * (the worker was down), the second send is dropped instead of doubling
 * the push. `notify` itself can't take that policy — pg-boss fixes a
 * queue's policy at creation, and 1.8.0 installs already have it.
 */
export const REMINDER_NOTIFY_JOB = 'notify-reminder';

export interface UserNotifyJobData extends DraftMessage {
  userId: string;
  /**
   * Which switch gates this message. `test` skips the switches — the
   * settings page's test button has to work before notifications are on.
   */
  category: NotificationCategory | 'test';
  priority?: NotificationPriority;
}

export interface ReminderNotifyJobData {
  /** The `notification_deliveries` row this send settles. */
  deliveryId: string;
  /**
   * ISO instant the event happens. A job that waited past it (the worker
   * was down, or a rollback left it unhandled) is dropped, not sent late.
   */
  eventAt: string;
  topic: string;
  /** For logs only; the sweep already applied the user's switches. */
  category: NotificationCategory;
  title: string;
  body: string;
  tags: string[];
  path: string;
}

export type NotifyJobData = UserNotifyJobData | ReminderNotifyJobData;

/** Thrown to hand a transient failure back to pg-boss for a retry. */
export class NotifyRetryableError extends Error {
  override name = 'NotifyRetryableError';
}

function errMessage(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : 'unknown';
}

/**
 * Queue a notification. Never throws: a notification is a convenience,
 * so a queueing failure is logged and the caller carries on. `dropped`
 * means a throttle (`singletonSeconds`) already holds the slot.
 */
export async function enqueueNotification(
  data: NotifyJobData,
  opts?: SendOptions,
): Promise<SendResult | 'failed'> {
  try {
    return await getJobs().send(NOTIFY_JOB, data, opts);
  } catch (err) {
    log.warn({ category: data.category, err: errMessage(err) }, 'notifications.enqueue_failed');
    return 'failed';
  }
}

/**
 * Queue a reminder send on the deduplicating reminder queue, keyed by
 * its delivery row. Never throws. `dropped` means a job for this delivery
 * is already waiting; `failed` leaves the row `queued`, so the sweep's
 * ten-minute reclaim tries it again.
 */
export async function enqueueReminder(data: ReminderNotifyJobData): Promise<SendResult | 'failed'> {
  try {
    return await getJobs().send(REMINDER_NOTIFY_JOB, data, { singletonKey: data.deliveryId });
  } catch (err) {
    log.warn({ category: data.category, err: errMessage(err) }, 'notifications.enqueue_failed');
    return 'failed';
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

type SendOutcome = 'sent' | 'unconfigured' | 'rejected';

/**
 * Send one message and classify the answer. Throws
 * {@link NotifyRetryableError} for an unreachable server or a 5xx / 429,
 * which pg-boss retries. A 4xx other than 429 is a setup problem — a
 * wrong token, no write access to the topic, a message the server
 * refuses — and retrying would get the same answer, so it is returned
 * as `rejected` and logged once.
 */
async function send(
  message: Omit<NotificationMessage, 'click'> & { path: string },
  category: string,
  onRetryable?: () => Promise<void>,
): Promise<SendOutcome> {
  const { path, ...rest } = message;
  const result = await getNotifier().notify({ ...rest, click: clickUrl(path) });
  if (result.ok) {
    log.info({ category }, 'notifications.sent');
    return 'sent';
  }
  if (result.reason === 'unconfigured') {
    log.debug({ category }, 'notifications.skipped.unconfigured');
    return 'unconfigured';
  }
  const status = result.status;
  if (result.reason === 'rejected' && status !== undefined && status < 500 && status !== 429) {
    log.warn({ category, status }, 'notifications.rejected');
    return 'rejected';
  }
  log.warn({ category, reason: result.reason, status }, 'notifications.send_failed');
  await onRetryable?.();
  throw new NotifyRetryableError(`ntfy ${result.reason}${status ? ` (${status})` : ''}`);
}

export async function runNotifyJob(data: NotifyJobData): Promise<void> {
  if ('deliveryId' in data) {
    await runReminder(data);
    return;
  }
  await runUserMessage(data);
}

async function runReminder(data: ReminderNotifyJobData): Promise<void> {
  if (Date.parse(data.eventAt) <= Date.now()) {
    log.info({ category: data.category }, 'notifications.skipped.event_passed');
    await markDelivery(data.deliveryId, 'skipped');
    return;
  }
  // Marked failed before a retryable throw: if every retry fails the row
  // says so, and a later success overwrites it with `sent`.
  const outcome = await send(
    { topic: data.topic, title: data.title, body: data.body, tags: data.tags, path: data.path },
    data.category,
    () => markDelivery(data.deliveryId, 'failed'),
  );
  await markDelivery(data.deliveryId, outcome === 'sent' ? 'sent' : 'failed');
}

async function runUserMessage(data: UserNotifyJobData): Promise<void> {
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

  await send(
    { topic, title: data.title, body, tags: data.tags, priority: data.priority, path: data.path },
    category,
  );
}
