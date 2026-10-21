'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/session';
import { err, ok, type Result } from '@/types/result';

import { deploymentTopic, notificationsConfigured } from './index';
import { enqueueNotification } from './job';
import { testMessage } from './messages';
import * as repo from './repo';
import { resolveTopic } from './topic';
import { notificationSettingsInput } from './validators';

const TEST_THROTTLE_SECONDS = 30;

export type SettingsFormError = {
  formMessage?: string;
  fields?: Record<string, string>;
};

export async function updateNotificationSettingsAction(
  raw: unknown,
): Promise<Result<null, SettingsFormError>> {
  const user = await requireUser();
  const parsed = notificationSettingsInput.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (key && fields[key] === undefined) fields[key] = issue.message;
    }
    return err({ fields, formMessage: 'Please fix the highlighted fields.' });
  }

  await repo.updateNotificationSettings(user.id, parsed.data);
  revalidatePath('/settings');
  return ok(null);
}

/**
 * Queue a test notification to the user's saved topic. Works before
 * notifications are switched on, so the subscription can be checked
 * first. Delivery happens in the worker; this only reports whether
 * there was anywhere to send it.
 */
export async function sendTestNotificationAction(): Promise<Result<null, SettingsFormError>> {
  const user = await requireUser();
  if (!notificationsConfigured()) return err({ formMessage: 'No ntfy server configured.' });

  const settings = await repo.getNotificationSettings(user.id);
  if (!settings || !resolveTopic(settings.topic, deploymentTopic())) {
    return err({ formMessage: 'No topic set.' });
  }

  // One test per user per 30 seconds. A replayed action can't flood the
  // topic or drain the ntfy rate limit that real notifications share;
  // a throttled send is dropped by pg-boss and still reads as sent here.
  const queued = await enqueueNotification(
    { ...testMessage(), userId: user.id, category: 'test' },
    { singletonKey: `notify-test:${user.id}`, singletonSeconds: TEST_THROTTLE_SECONDS },
  );
  return queued ? ok(null) : err({ formMessage: 'Could not queue the test.' });
}
