// DB access for notification settings. The only module under
// `src/lib/notifications/` that touches `@/db/*`.

import { and, between, eq, inArray, ne, or } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  documentSegments,
  notificationDeliveries,
  segments,
  trips,
  tripNotificationMutes,
  users,
  type NotificationDeliveryStatus,
} from '@/db/schema';
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

// ---- Trip reminders (ADR-0020) ------------------------------------------

export interface ReminderRecipient {
  userId: string;
  /** The user's own topic, or null for the deployment default. */
  topic: string | null;
  prefs: NotificationPrefs;
}

/** Everyone who has notifications switched on. */
export async function listReminderRecipients(): Promise<ReminderRecipient[]> {
  const rows = await db
    .select({ userId: users.id, topic: users.ntfyTopic, prefs: users.notificationPrefs })
    .from(users)
    .where(eq(users.notificationsEnabled, true));
  return rows.map((r) => ({ ...r, prefs: parseNotificationPrefs(r.prefs) }));
}

export interface ReminderCandidateRow {
  id: string;
  tripId: string;
  type: 'flight' | 'hotel' | 'activity' | 'transit' | 'food';
  data: unknown;
  startsAt: Date | null;
  endsAt: Date | null;
  locationName: string | null;
  countryCode: string | null;
  tripOwnerId: string;
  tripVisibility: 'household' | 'private';
}

const REMINDER_TYPES = ['flight', 'hotel', 'activity', 'transit', 'food'] as const;

/**
 * Dated segments of non-archived trips that start inside [from, to], plus
 * hotels that check out inside it. The bounds compare floating wall-clock
 * values against real instants, so callers pad them by more than any
 * zone offset.
 */
export async function listReminderCandidates(
  from: Date,
  to: Date,
): Promise<ReminderCandidateRow[]> {
  const rows = await db
    .select({
      id: segments.id,
      tripId: segments.tripId,
      type: segments.type,
      data: segments.data,
      startsAt: segments.startsAt,
      endsAt: segments.endsAt,
      locationName: segments.locationName,
      countryCode: segments.countryCode,
      tripOwnerId: trips.userId,
      tripVisibility: trips.visibility,
    })
    .from(segments)
    .innerJoin(trips, eq(trips.id, segments.tripId))
    .where(
      and(
        ne(trips.status, 'archived'),
        inArray(segments.type, [...REMINDER_TYPES]),
        or(
          between(segments.startsAt, from, to),
          and(eq(segments.type, 'hotel'), between(segments.endsAt, from, to)),
        ),
      ),
    );
  return rows as ReminderCandidateRow[];
}

/** `${userId}:${tripId}` for every mute on the given trips. */
export async function listTripMutes(tripIds: readonly string[]): Promise<Set<string>> {
  if (tripIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: tripNotificationMutes.userId, tripId: tripNotificationMutes.tripId })
    .from(tripNotificationMutes)
    .where(inArray(tripNotificationMutes.tripId, [...tripIds]));
  return new Set(rows.map((r) => `${r.userId}:${r.tripId}`));
}

/** Linked document ids per segment — one half of a flight's booking identity. */
export async function documentIdsBySegment(
  segmentIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (segmentIds.length === 0) return out;
  const rows = await db
    .select({ segmentId: documentSegments.segmentId, documentId: documentSegments.documentId })
    .from(documentSegments)
    .where(inArray(documentSegments.segmentId, [...segmentIds]));
  for (const r of rows) {
    const list = out.get(r.segmentId) ?? [];
    list.push(r.documentId);
    out.set(r.segmentId, list);
  }
  return out;
}

/**
 * Record a reminder for a topic. Returns the new row's id, or null when
 * the same reminder was already recorded for that topic — the unique
 * index is what keeps a topic from getting it twice.
 */
export async function recordDelivery(input: {
  topic: string;
  kind: string;
  segmentId: string;
  fireAt: Date;
  status: 'queued' | 'skipped';
}): Promise<string | null> {
  const [row] = await db
    .insert(notificationDeliveries)
    .values(input)
    .onConflictDoNothing()
    .returning({ id: notificationDeliveries.id });
  return row?.id ?? null;
}

export async function markDelivery(
  id: string,
  status: Exclude<NotificationDeliveryStatus, 'queued'>,
): Promise<void> {
  await db
    .update(notificationDeliveries)
    .set({ status, sentAt: status === 'sent' ? new Date() : null })
    .where(eq(notificationDeliveries.id, id));
}

export async function isTripMuted(userId: string, tripId: string): Promise<boolean> {
  const [row] = await db
    .select({ tripId: tripNotificationMutes.tripId })
    .from(tripNotificationMutes)
    .where(and(eq(tripNotificationMutes.userId, userId), eq(tripNotificationMutes.tripId, tripId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Mute or unmute a trip's reminders for one user. Returns false when the
 * user can't see the trip, so a guessed id can't be muted.
 */
export async function setTripMuted(
  userId: string,
  tripId: string,
  muted: boolean,
): Promise<boolean> {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), tripVisibleToViewer(userId)))
    .limit(1);
  if (!trip) return false;
  if (muted) {
    await db.insert(tripNotificationMutes).values({ userId, tripId }).onConflictDoNothing();
  } else {
    await db
      .delete(tripNotificationMutes)
      .where(
        and(eq(tripNotificationMutes.userId, userId), eq(tripNotificationMutes.tripId, tripId)),
      );
  }
  return true;
}

/**
 * Whether the trip page should offer the mute switch, and its state:
 * null when the user would get no reminders anyway (no server, or
 * notifications off).
 */
export async function getTripReminderState(
  userId: string,
  tripId: string,
): Promise<{ muted: boolean } | null> {
  const settings = await getNotificationSettings(userId);
  if (!settings?.enabled) return null;
  return { muted: await isTripMuted(userId, tripId) };
}
