import { z } from 'zod';

// Per-user notification switches, stored as JSONB on `users`. Every key
// defaults to on, so a key missing from a stored row (a category added
// after the user last saved) reads as enabled without a data migration.
// The master switch is `users.notifications_enabled`; these only
// narrow what an opted-in user receives.
export const notificationPrefsSchema = z.object({
  // Document reading finished or failed. Sent to the uploader only.
  extraction: z.boolean().default(true),
  // Trip reminders (ADR-0020), one switch per family of segments.
  flights: z.boolean().default(true),
  transit: z.boolean().default(true),
  hotels: z.boolean().default(true),
  // Timed (or date-only) activities and food.
  plans: z.boolean().default(true),
});

export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;
export type NotificationCategory = keyof NotificationPrefs;

/**
 * Read stored prefs leniently: a malformed or foreign value falls back
 * to the defaults rather than failing the caller. The column is written
 * only through the validated settings action, so this is defence against
 * hand edits, not a normal path.
 */
export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
  const parsed = notificationPrefsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : notificationPrefsSchema.parse({});
}
