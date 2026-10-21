import { z } from 'zod';

import { notificationPrefsSchema } from './prefs';
import { isValidTopic } from './topic';

// Settings form input. An empty topic means "use the deployment
// default" and is stored as null.
export const notificationSettingsInput = z.object({
  enabled: z.boolean(),
  topic: z
    .string()
    .trim()
    .refine((v) => v === '' || isValidTopic(v), 'Up to 64 letters, digits, - or _.')
    .transform((v) => (v === '' ? null : v)),
  prefs: notificationPrefsSchema,
});

export type NotificationSettingsInput = z.input<typeof notificationSettingsInput>;
