import { z } from 'zod';

import { notificationPrefsSchema } from './prefs';
import { isValidTopic } from './topic';

// Settings form input. An empty topic means "use the deployment
// default" and is stored as null. `null` is accepted on the way in too:
// the form validates with this schema client-side and hands the action
// its OUTPUT, so the action re-parses an already-transformed value.
export const notificationSettingsInput = z.object({
  enabled: z.boolean(),
  topic: z
    .string()
    .nullable()
    .transform((v) => (v ?? '').trim())
    .refine((v) => v === '' || isValidTopic(v), 'Up to 64 letters, digits, - or _.')
    .transform((v) => (v === '' ? null : v)),
  prefs: notificationPrefsSchema,
});

export type NotificationSettingsInput = z.input<typeof notificationSettingsInput>;
