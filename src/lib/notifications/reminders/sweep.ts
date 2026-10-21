// The reminder sweep (ADR-0020): runs in the worker every few minutes,
// works out which trip reminders are due from the current segment data,
// records each one per ntfy topic and queues the send.
//
// Deriving reminders from current data every time is the point: an edit,
// a reschedule or a deletion takes effect on the next run with nothing to
// cancel. The delivery table's unique index is what stops a topic hearing
// the same reminder twice, however often the sweep runs.

import { getPlaceCoordsView } from '@/lib/geocoding/place-coords';
import type { PlaceLike } from '@/lib/geocoding/segment-query';
import { log } from '@/lib/log';
import { wallClockToEpoch } from '@/lib/timezones/convert';
import { zoneAt, zoneForAirport, zoneForCountry } from '@/lib/timezones/resolve';

import { deploymentTopic, notificationsConfigured } from '../index';
import { enqueueNotification } from '../job';
import {
  documentIdsBySegment,
  listReminderCandidates,
  listReminderRecipients,
  listTripMutes,
  markDelivery,
  recordDelivery,
  type ReminderCandidateRow,
  type ReminderRecipient,
} from '../repo';
import { resolveTopic } from '../topic';
import {
  connectingLegIds,
  dueReminders,
  planReminders,
  type FlightLeg,
  type PlannedReminder,
  type ReminderSegment,
} from './plan';

export const REMINDER_SWEEP_JOB = 'reminder-sweep';

const HOUR = 3_600_000;
// Floating wall-clock values sit up to ±14h from the real instant, and a
// connection check needs the previous leg (up to ~a day earlier). The
// window is generous; planning, not the query, decides what is due.
const LOOKBACK_MS = 72 * HOUR;
const LOOKAHEAD_MS = 72 * HOUR;

export interface SweepCounts {
  candidates: number;
  due: number;
  queued: number;
  skipped: number;
  noZone: number;
}

const EMPTY: SweepCounts = { candidates: 0, due: 0, queued: 0, skipped: 0, noZone: 0 };

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

function str(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** The zone each candidate starts in, or null when it can't be told. */
async function resolveZones(rows: readonly ReminderCandidateRow[]): Promise<Map<string, string>> {
  const zones = new Map<string, string>();
  const places: (PlaceLike & { id: string })[] = [];
  for (const row of rows) {
    if (row.type === 'flight') {
      const tz = zoneForAirport(str(asRecord(row.data), 'originAirport'));
      if (tz) zones.set(row.id, tz);
    } else {
      places.push({
        id: row.id,
        type: row.type,
        data: row.data,
        locationName: row.locationName,
        countryCode: row.countryCode,
      });
    }
  }
  if (places.length > 0) {
    const { coordsById } = await getPlaceCoordsView(places);
    for (const place of places) {
      const coords = coordsById.get(place.id);
      // A transit leg starts at its origin; its primary point is the
      // destination, which can be in another zone.
      const point = coords?.endpoints?.origin ?? coords ?? null;
      const tz = (point ? zoneAt(point.lat, point.lng) : null) ?? zoneForCountry(place.countryCode);
      if (tz) zones.set(place.id, tz);
    }
  }
  return zones;
}

/** Flight legs that connect from an earlier leg on the same booking. */
async function findConnections(
  rows: readonly ReminderCandidateRow[],
  zones: ReadonlyMap<string, string>,
): Promise<Set<string>> {
  const flights = rows.filter((r) => r.type === 'flight');
  if (flights.length < 2) return new Set();
  const docs = await documentIdsBySegment(flights.map((f) => f.id));
  const legs: FlightLeg[] = flights.map((f) => {
    const data = asRecord(f.data);
    const pnr = str(data, 'pnr');
    const departZone = zones.get(f.id) ?? null;
    const arriveZone = zoneForAirport(str(data, 'destinationAirport'));
    return {
      id: f.id,
      bookingKeys: [
        ...(pnr ? [`pnr:${pnr.toUpperCase()}`] : []),
        ...(docs.get(f.id) ?? []).map((id) => `doc:${id}`),
      ],
      departAt: f.startsAt && departZone ? wallClockToEpoch(f.startsAt, departZone) : null,
      arriveAt: f.endsAt && arriveZone ? wallClockToEpoch(f.endsAt, arriveZone) : null,
    };
  });
  return connectingLegIds(legs);
}

/**
 * Who should hear about a reminder on this trip: users who can see the
 * trip, have that reminder kind switched on and haven't muted the trip.
 */
function recipientsFor(
  reminder: PlannedReminder,
  row: ReminderCandidateRow,
  recipients: readonly ReminderRecipient[],
  mutes: ReadonlySet<string>,
): ReminderRecipient[] {
  return recipients.filter(
    (r) =>
      (row.tripVisibility === 'household' || row.tripOwnerId === r.userId) &&
      r.prefs[reminder.category] &&
      !mutes.has(`${r.userId}:${row.tripId}`),
  );
}

export async function runReminderSweep(now: Date = new Date()): Promise<SweepCounts> {
  if (!notificationsConfigured()) return EMPTY;
  const recipients = await listReminderRecipients();
  if (recipients.length === 0) return EMPTY;

  const nowMs = now.getTime();
  const rows = await listReminderCandidates(
    new Date(nowMs - LOOKBACK_MS),
    new Date(nowMs + LOOKAHEAD_MS),
  );
  if (rows.length === 0) return EMPTY;

  const zones = await resolveZones(rows);
  const connections = await findConnections(rows, zones);
  const mutes = await listTripMutes([...new Set(rows.map((r) => r.tripId))]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sharedTopic = deploymentTopic();

  const planned: PlannedReminder[] = [];
  let noZone = 0;
  for (const row of rows) {
    const zone = zones.get(row.id) ?? null;
    if (!zone) noZone += 1;
    const segment: ReminderSegment = {
      id: row.id,
      tripId: row.tripId,
      type: row.type,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      data: asRecord(row.data),
      locationName: row.locationName,
      zone,
      isConnection: connections.has(row.id),
    };
    planned.push(...planReminders(segment));
  }

  const due = dueReminders(planned, nowMs);
  let queued = 0;
  let skipped = 0;
  for (const { reminder, status } of due) {
    const row = byId.get(reminder.segmentId)!;
    // One delivery per topic: two people on the same topic hear it once.
    const topics = new Set<string>();
    for (const r of recipientsFor(reminder, row, recipients, mutes)) {
      const topic = resolveTopic(r.topic, sharedTopic);
      if (topic) topics.add(topic);
    }
    for (const topic of topics) {
      const deliveryId = await recordDelivery({
        topic,
        kind: reminder.kind,
        segmentId: reminder.segmentId,
        fireAt: new Date(reminder.fireAt),
        status: status === 'send' ? 'queued' : 'skipped',
      });
      if (!deliveryId) continue;
      if (status === 'skip') {
        skipped += 1;
        continue;
      }
      // Everyone on the shared default topic sees what lands there, so a
      // private trip's reminder goes out without its names.
      const redact = row.tripVisibility === 'private' && topic === sharedTopic;
      const result = await enqueueNotification({
        deliveryId,
        topic,
        category: reminder.category,
        title: redact ? reminder.privateTitle : reminder.title,
        body: redact ? reminder.privateBody : reminder.body,
        tags: reminder.tags,
        path: `/trips/${reminder.tripId}/itinerary#seg-${reminder.segmentId}`,
      });
      if (result === 'queued') queued += 1;
      // The row is written but nothing will send it; say so rather than
      // leave it reading `queued` forever.
      else await markDelivery(deliveryId, 'failed');
    }
  }

  const counts = { candidates: rows.length, due: due.length, queued, skipped, noZone };
  if (queued > 0 || skipped > 0) log.info(counts, 'notifications.reminders.swept');
  return counts;
}
