// Trip reminder rules (ADR-0020), kept pure: segment + zone + now in,
// reminders out. Everything about WHEN a reminder fires and WHAT it says
// lives here, so the rules can be tested without a database or a server.
//
// Times. Segment times are floating wall-clock values (ADR-0014/0016).
// A reminder needs a real instant, so each segment arrives with the IANA
// zone of where it happens, resolved by the sweep. Without a zone there
// is no reminder: one that fires hours off is worse than none.
//
// Titles carry the absolute time ("VN54 departs tomorrow 06:00"), never
// a countdown, because the night rule can move a reminder hours earlier.

import { epochToWallClock, wallClockToEpoch } from '@/lib/timezones/convert';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type ReminderKind =
  | 'flight-24h'
  | 'flight-4h'
  | 'transit'
  | 'checkin'
  | 'checkout'
  | 'plan'
  // A date-only segment's 09:00 "today" reminder.
  | 'today';

export type ReminderCategory = 'flights' | 'transit' | 'hotels' | 'plans';

export type ReminderSegmentType = 'flight' | 'hotel' | 'activity' | 'transit' | 'food';

// How far ahead of the event each lead-time reminder fires.
export const LEAD_MS = {
  'flight-24h': 24 * HOUR,
  'flight-4h': 4 * HOUR,
  transit: 3 * HOUR,
  checkin: 3 * HOUR,
  plan: 1 * HOUR,
} as const;

// A lead-time reminder landing in [23:00, 07:00) local is moved to 22:00
// the evening before, so nothing wakes anyone up.
const NIGHT_START_HOUR = 23;
const NIGHT_END_HOUR = 7;
const NIGHT_MOVED_TO_HOUR = 22;
// Date-only segments get a reminder at 09:00 on the day.
const TODAY_HOUR = 9;
// Check-out is announced at 20:00 the evening before.
const CHECKOUT_EVE_HOUR = 20;

/** A reminder more than this late (the worker was down) is skipped, not sent. */
export const GRACE_MS = 30 * MINUTE;

/** A flight leg leaving within this long of the previous leg's arrival is a connection. */
export const CONNECTION_WINDOW_MS = 12 * HOUR;

export interface ReminderSegment {
  id: string;
  tripId: string;
  type: ReminderSegmentType;
  startsAt: Date | null;
  endsAt: Date | null;
  data: Record<string, unknown>;
  locationName: string | null;
  /** IANA zone where the segment starts, or null when it can't be told. */
  zone: string | null;
  /** A connecting flight leg: no 24h / 4h reminders of its own. */
  isConnection?: boolean;
}

export interface PlannedReminder {
  segmentId: string;
  tripId: string;
  kind: ReminderKind;
  category: ReminderCategory;
  /** Epoch ms the reminder is due. */
  fireAt: number;
  /** Epoch ms the thing itself happens; nothing is sent once it has. */
  eventAt: number;
  title: string;
  body: string;
  /** Name-free wording for a private trip on a shared topic. */
  privateTitle: string;
  privateBody: string;
  tags: string[];
}

export const CATEGORY_BY_TYPE: Record<ReminderSegmentType, ReminderCategory> = {
  flight: 'flights',
  transit: 'transit',
  hotel: 'hotels',
  activity: 'plans',
  food: 'plans',
};

const PRIVATE_BODY = 'Private trip';

const TRANSIT_LABEL: Record<string, string> = {
  train: 'Train',
  bus: 'Bus',
  ferry: 'Ferry',
  car: 'Car',
  other: 'Transit',
};

const TRANSIT_TAG: Record<string, string> = {
  train: 'train',
  bus: 'bus',
  ferry: 'ferry',
  car: 'red_car',
  other: 'round_pushpin',
};

// ---- small helpers ------------------------------------------------------

function str(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function hasTime(wall: Date): boolean {
  return wall.getUTCHours() !== 0 || wall.getUTCMinutes() !== 0 || wall.getUTCSeconds() !== 0;
}

function wallAtHour(day: Date, hour: number, dayOffset = 0): Date {
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + dayOffset, hour),
  );
}

function hhmm(wall: Date): string {
  const h = String(wall.getUTCHours()).padStart(2, '0');
  const m = String(wall.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });

function dayIndex(wall: Date): number {
  return Math.floor(wall.getTime() / DAY);
}

/**
 * "" when the event is on the day the reminder arrives, "tomorrow " for
 * the next day, otherwise the weekday ("Fri ").
 */
function dayWord(fireWall: Date, eventWall: Date): string {
  const diff = dayIndex(eventWall) - dayIndex(fireWall);
  if (diff <= 0) return '';
  if (diff === 1) return 'tomorrow ';
  return `${WEEKDAY.format(eventWall)} `;
}

/** "at 19:30", or "tomorrow at 07:30" when the reminder lands the day before. */
function atWhen(fireWall: Date, eventWall: Date): string {
  return `${dayWord(fireWall, eventWall)}at ${hhmm(eventWall)}`;
}

interface Timing {
  fireAt: number;
  fireWall: Date;
  eventAt: number;
}

/** A lead-time reminder, with the night rule applied. */
function leadTiming(eventWall: Date, zone: string, leadMs: number): Timing | null {
  const eventAt = wallClockToEpoch(eventWall, zone);
  if (eventAt === null) return null;
  let fireAt = eventAt - leadMs;
  let fireWall = epochToWallClock(fireAt, zone);
  if (!fireWall) return null;

  const hour = fireWall.getUTCHours();
  if (hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR) {
    const moved = wallAtHour(fireWall, NIGHT_MOVED_TO_HOUR, hour >= NIGHT_START_HOUR ? 0 : -1);
    const movedAt = wallClockToEpoch(moved, zone);
    if (movedAt === null) return null;
    fireAt = movedAt;
    fireWall = moved;
  }
  return { fireAt, fireWall, eventAt };
}

/** A reminder at a fixed local hour, `dayOffset` days from `day`. */
function fixedTiming(
  day: Date,
  hour: number,
  dayOffset: number,
  zone: string,
  eventWall: Date,
): Timing | null {
  const fireWall = wallAtHour(day, hour, dayOffset);
  const fireAt = wallClockToEpoch(fireWall, zone);
  const eventAt = wallClockToEpoch(eventWall, zone);
  if (fireAt === null || eventAt === null) return null;
  return { fireAt, fireWall, eventAt };
}

/**
 * A date-only segment's 09:00 reminder. The event counts as running until
 * the end of its day, so the reminder isn't dropped as "already started"
 * for a segment stored at midnight.
 */
function todayTiming(day: Date, zone: string): Timing | null {
  return fixedTiming(day, TODAY_HOUR, 0, zone, wallAtHour(day, 0, 1));
}

// ---- per-type planning --------------------------------------------------

type Draft = Omit<PlannedReminder, 'segmentId' | 'tripId' | 'category' | 'kind'> & {
  kind: ReminderKind;
};

function planFlight(seg: ReminderSegment, zone: string): Draft[] {
  const start = seg.startsAt!;
  const label = str(seg.data, 'flightNumber') ?? 'Flight';
  const origin = str(seg.data, 'originAirport');
  const destination = str(seg.data, 'destinationAirport');
  const body =
    origin && destination
      ? `${origin} → ${destination}`
      : (str(seg.data, 'carrier') ?? seg.locationName ?? 'Flight');
  const tags = ['airplane'];

  if (!hasTime(start)) {
    if (seg.isConnection) return [];
    const t = todayTiming(start, zone);
    if (!t) return [];
    return [
      {
        kind: 'today',
        ...t,
        title: `${label} today`,
        body,
        privateTitle: 'Flight today',
        privateBody: PRIVATE_BODY,
        tags,
      },
    ];
  }
  if (seg.isConnection) return [];

  const drafts: Draft[] = [];
  for (const kind of ['flight-24h', 'flight-4h'] as const) {
    const t = leadTiming(start, zone, LEAD_MS[kind]);
    if (!t) continue;
    const when = `${dayWord(t.fireWall, start)}${hhmm(start)}`;
    drafts.push({
      kind,
      ...t,
      title: `${label} departs ${when}`,
      body,
      privateTitle: `Flight departs ${when}`,
      privateBody: PRIVATE_BODY,
      tags,
    });
  }
  return drafts;
}

function planTransit(seg: ReminderSegment, zone: string): Draft[] {
  const start = seg.startsAt!;
  const mode = str(seg.data, 'mode') ?? 'other';
  const label = TRANSIT_LABEL[mode] ?? 'Transit';
  const from = str(seg.data, 'fromName');
  const to = str(seg.data, 'toName');
  const body =
    from && to
      ? `${from} → ${to}`
      : (to ?? from ?? str(seg.data, 'carrier') ?? seg.locationName ?? label);
  const tags = [TRANSIT_TAG[mode] ?? 'round_pushpin'];
  // Car and other legs are pick-ups as often as departures.
  const departs = mode === 'train' || mode === 'bus' || mode === 'ferry';

  if (!hasTime(start)) {
    const t = todayTiming(start, zone);
    if (!t) return [];
    return [
      {
        kind: 'today',
        ...t,
        title: `${label} today`,
        body,
        privateTitle: `${label} today`,
        privateBody: PRIVATE_BODY,
        tags,
      },
    ];
  }
  const t = leadTiming(start, zone, LEAD_MS.transit);
  if (!t) return [];
  const when = departs
    ? `departs ${dayWord(t.fireWall, start)}${hhmm(start)}`
    : atWhen(t.fireWall, start);
  return [
    {
      kind: 'transit',
      ...t,
      title: `${label} ${when}`,
      body,
      privateTitle: `${label} ${when}`,
      privateBody: PRIVATE_BODY,
      tags,
    },
  ];
}

function planHotel(seg: ReminderSegment, zone: string): Draft[] {
  const start = seg.startsAt!;
  const name = str(seg.data, 'propertyName') ?? seg.locationName ?? 'Hotel';
  const tags = ['hotel'];
  const drafts: Draft[] = [];

  const checkin = hasTime(start)
    ? leadTiming(start, zone, LEAD_MS.checkin)
    : todayTiming(start, zone);
  if (checkin) {
    const title = hasTime(start)
      ? `Check-in ${dayWord(checkin.fireWall, start)}${hhmm(start)}`
      : 'Check-in today';
    drafts.push({
      kind: hasTime(start) ? 'checkin' : 'today',
      ...checkin,
      title,
      body: name,
      privateTitle: title,
      privateBody: PRIVATE_BODY,
      tags,
    });
  }

  const end = seg.endsAt;
  if (end) {
    const checkout = fixedTiming(end, CHECKOUT_EVE_HOUR, -1, zone, end);
    // A day-use stay checks out the day it checks in, so "the evening
    // before" would come before the stay starts: no check-out note. Any
    // stay over a night keeps it, even one checking in after 20:00.
    if (checkout && dayIndex(end) > dayIndex(start)) {
      const title = hasTime(end) ? `Check out tomorrow by ${hhmm(end)}` : 'Check out tomorrow';
      drafts.push({
        kind: 'checkout',
        ...checkout,
        title,
        body: name,
        privateTitle: title,
        privateBody: PRIVATE_BODY,
        tags,
      });
    }
  }
  return drafts;
}

function planPlan(seg: ReminderSegment, zone: string): Draft[] {
  const start = seg.startsAt!;
  const isFood = seg.type === 'food';
  const typeLabel = isFood ? 'Food' : 'Activity';
  const name = str(seg.data, isFood ? 'venue' : 'title') ?? typeLabel;
  const body = seg.locationName ?? typeLabel;
  const tags = [isFood ? 'fork_and_knife' : 'round_pushpin'];

  if (!hasTime(start)) {
    const t = todayTiming(start, zone);
    if (!t) return [];
    return [
      {
        kind: 'today',
        ...t,
        title: `Today: ${name}`,
        body,
        privateTitle: `Today: ${typeLabel}`,
        privateBody: PRIVATE_BODY,
        tags,
      },
    ];
  }
  const t = leadTiming(start, zone, LEAD_MS.plan);
  if (!t) return [];
  const when = atWhen(t.fireWall, start);
  return [
    {
      kind: 'plan',
      ...t,
      title: `${name} ${when}`,
      body,
      privateTitle: `${typeLabel} ${when}`,
      privateBody: PRIVATE_BODY,
      tags,
    },
  ];
}

/** Every reminder a segment produces, due or not. Empty without a zone or a date. */
export function planReminders(seg: ReminderSegment): PlannedReminder[] {
  if (!seg.zone || !seg.startsAt) return [];
  let drafts: Draft[];
  switch (seg.type) {
    case 'flight':
      drafts = planFlight(seg, seg.zone);
      break;
    case 'transit':
      drafts = planTransit(seg, seg.zone);
      break;
    case 'hotel':
      drafts = planHotel(seg, seg.zone);
      break;
    case 'activity':
    case 'food':
      drafts = planPlan(seg, seg.zone);
      break;
  }
  const category = CATEGORY_BY_TYPE[seg.type];
  return drafts.map((d) => ({ ...d, segmentId: seg.id, tripId: seg.tripId, category }));
}

export type DueStatus = 'send' | 'skip';

/**
 * What to do with each planned reminder right now: `send` when it is due
 * and on time, `skip` when it is overdue past the grace period. Reminders
 * not yet due, or whose event has already started, are left out.
 */
export function dueReminders(
  planned: readonly PlannedReminder[],
  now: number,
  graceMs: number = GRACE_MS,
): { reminder: PlannedReminder; status: DueStatus }[] {
  const out: { reminder: PlannedReminder; status: DueStatus }[] = [];
  for (const reminder of planned) {
    if (reminder.fireAt > now) continue;
    if (reminder.eventAt <= now) continue;
    out.push({ reminder, status: now - reminder.fireAt > graceMs ? 'skip' : 'send' });
  }
  return out;
}

export interface FlightLeg {
  id: string;
  /** Booking identity: the PNR and every linked document id. */
  bookingKeys: readonly string[];
  /** Epoch ms of departure and arrival, when known. */
  departAt: number | null;
  arriveAt: number | null;
}

/**
 * Legs that leave within {@link CONNECTION_WINDOW_MS} of an earlier leg's
 * arrival on the same booking. The first leg's reminders cover the
 * journey; these get none of their own.
 */
export function connectingLegIds(
  legs: readonly FlightLeg[],
  windowMs: number = CONNECTION_WINDOW_MS,
): Set<string> {
  const out = new Set<string>();
  for (const leg of legs) {
    if (leg.departAt === null || leg.bookingKeys.length === 0) continue;
    for (const prev of legs) {
      if (prev.id === leg.id || prev.departAt === null) continue;
      if (!prev.bookingKeys.some((k) => leg.bookingKeys.includes(k))) continue;
      if (prev.departAt >= leg.departAt) continue;
      // An unknown arrival reads as the departure: a conservative guess
      // that only ever widens the gap.
      const landed = prev.arriveAt ?? prev.departAt;
      const gap = leg.departAt - landed;
      if (gap >= 0 && gap < windowMs) {
        out.add(leg.id);
        break;
      }
    }
  }
  return out;
}
