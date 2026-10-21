// DB access for notification settings. The only module under
// `src/lib/notifications/` that touches `@/db/*`.

import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { trips, users } from '@/db/schema';
import { tripVisibleToViewer } from '@/lib/trips/repo';

import { parseNotificationPrefs, type NotificationPrefs } from './prefs';

export interface NotificationSettings {
  enabled: boolean;
  /** The user's own topic, or null to use the deployment default. */
  topic: string | null;
  prefs: NotificationPrefs;
}

export async function getNotificationSettings(
  userId: string,
): Promise<NotificationSettings | null> {
  const [row] = await db
    .select({
      enabled: users.notificationsEnabled,
      topic: users.ntfyTopic,
      prefs: users.notificationPrefs,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  return { enabled: row.enabled, topic: row.topic, prefs: parseNotificationPrefs(row.prefs) };
}

export async function updateNotificationSettings(
  userId: string,
  settings: NotificationSettings,
): Promise<void> {
  await db
    .update(users)
    .set({
      notificationsEnabled: settings.enabled,
      ntfyTopic: settings.topic,
      notificationPrefs: settings.prefs,
    })
    .where(eq(users.id, userId));
}

/**
 * A trip's title as `userId` may see it, plus whether it is private, or
 * null when the trip is gone or private to someone else. Used to name the
 * trip in a notification without widening what that user could already
 * read in the app.
 */
export async function tripForNotification(
  userId: string,
  tripId: string,
): Promise<{ title: string; isPrivate: boolean } | null> {
  const [row] = await db
    .select({ title: trips.title, visibility: trips.visibility })
    .from(trips)
    .where(and(eq(trips.id, tripId), tripVisibleToViewer(userId)))
    .limit(1);
  return row ? { title: row.title, isPrivate: row.visibility === 'private' } : null;
}
