import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7Pk } from './_helpers';
import { segments } from './segments';
import { trips } from './trips';
import { users } from './users';

export const notificationDeliveryStatus = pgEnum('notification_delivery_status', [
  // Recorded by the reminder sweep and handed to the notify job.
  'queued',
  'sent',
  // The notify job gave up (setup error, or retries exhausted).
  'failed',
  // Found more than the grace period late — the worker was down — and
  // recorded instead of sent, so it isn't evaluated again; or its send job
  // only ran after the event had started (ADR-0020).
  'skipped',
]);

// One row per trip reminder per ntfy TOPIC (ADR-0020). Topic, not user:
// two people sharing a topic get one message, and the unique index is
// what guarantees it, even if two sweeps overlap. The key holds the
// EVENT time rather than the fire time: the night rule and the fixed
// 20:00 / 09:00 reminders give many events the same fire time, so a
// flight moved from 06:00 to 07:30 after its 22:00 reminder went out
// still earns a corrected one. Rows go with their segment, and the
// nightly prune drops them after 90 days.
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuidv7Pk().primaryKey(),
    topic: text('topic').notNull(),
    // Reminder kind (`flight-24h`, `checkout`, …). Text rather than an
    // enum so a new kind needs no migration; the app owns the vocabulary.
    kind: text('kind').notNull(),
    segmentId: uuid('segment_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    // When the thing happens (departure, check-in, …), as a real instant.
    eventAt: timestamp('event_at', { withTimezone: true, mode: 'date' }).notNull(),
    // When the reminder was due. History only; not part of the key.
    fireAt: timestamp('fire_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: notificationDeliveryStatus('status').notNull().default('queued'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    // Leads with segment_id so it also serves the ON DELETE CASCADE from
    // segments — no separate segment index needed.
    uniqueIndex('notification_deliveries_dedupe_idx').on(t.segmentId, t.kind, t.topic, t.eventAt),
    // Prune scans by age.
    index('notification_deliveries_created_idx').on(t.createdAt),
  ],
);

// A user's "no reminders for this trip" switch, set from the trip menu.
// Presence of the row is the mute. Per user, so muting a shared trip
// doesn't silence anyone else in the household.
export const tripNotificationMutes = pgTable(
  'trip_notification_mutes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.tripId] }),
    index('trip_notification_mutes_trip_idx').on(t.tripId),
  ],
);

export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type NotificationDeliveryStatus = (typeof notificationDeliveryStatus.enumValues)[number];
