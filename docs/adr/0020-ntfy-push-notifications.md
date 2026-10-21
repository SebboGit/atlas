# ADR-0020: Push notifications through a self-hosted ntfy server

- **Status:** Accepted
- **Date:** 2026-10-21
- **Deciders:** @SebboGit

## Context

Atlas has had ntfy on its roadmap since the scope cuts of May 2026: short pushes for an upcoming flight, a hotel check-in, or a document that finished reading. Email via n8n was dropped at the same time. ADR-0012 brought in pg-boss partly so that these sends could be durable and retried, and CLAUDE.md has described the intended `Notifier` interface ever since. This ADR settles the parts that were still open once the feature met a real server.

Three facts shape the design.

A self-hosted ntfy server is usually locked down. The common setup denies by default and gives each publisher its own user with write access to named topics only, authenticated by an access token. A publisher on such a server cannot create a topic or pick a fresh random name, because every topic it writes to has to be granted by the operator first. The server also often lives on a private network that containers cannot resolve without help.

Atlas stores times as floating wall-clock values (ADR-0014, ADR-0016). A flight printed as 06:00 is stored as 06:00 UTC and shown as 06:00, with no zone attached. Display never needs a zone, but a reminder that fires three hours before departure has to know the real instant.

Trips are shared across the household by default (ADR-0015). A reminder for a shared trip is relevant to everyone travelling on it, but a member who never set up a phone should receive nothing, and a private trip must never surface on someone else's device.

## Decision

**Interface.** Feature code depends on a `Notifier` interface in `src/lib/notifications/`. The one implementation, `ntfy.ts`, publishes with ntfy's JSON form (a POST to the server root with the topic in the body) because titles carry UTF-8 that HTTP headers cannot hold cleanly. It never throws; a failure comes back as a result. It sends no attachments, so links travel in ntfy's click action and work on servers with attachments switched off. Titles are clipped to 80 characters, bodies to 300 and tags to three.

**Every send runs in the worker.** Callers queue a `notify` pg-boss job and move on, so a slow or unreachable server never holds up a request. This also means only the worker container needs network reach to the ntfy host and only the worker holds `NTFY_TOKEN`. The settings page's test button queues the same job, throttled to one per user every 30 seconds so a replayed action cannot flood the topic. The handler reads the recipient's settings when it runs rather than when it was queued, so switching notifications off takes effect for anything still waiting. An unreachable server or a 5xx or 429 answer is thrown back to pg-boss for three retries with exponential backoff, at most about 30 seconds, 1 minute and 2 minutes apart. Any other 4xx (a wrong token, no write access to the topic, a refused message) is logged once and not retried, because the same request would get the same answer. At boot the worker checks `/v1/health` after it reports ready and logs a warning if the server cannot be reached, so a wrong URL or a missing host pin shows up at deploy time.

**Topics come from the operator.** `NTFY_TOPIC` is the deployment default. A user can enter their own topic in `/settings`, which the operator has to grant the publisher write access to. Atlas never generates a topic name. Notifications are opt-in per user and off by default, so a household member who has not set anything up receives nothing, even for a trip they share.

**What is sent, and to whom.** Document-reading results (finished or failed) go to the uploader only. Trip reminders go to every member who can see the trip through `tripVisibleToViewer` and has notifications on, with a per-trip mute, so a private trip's reminders are only ever addressed to its owner. A topic is not a person, though: everyone subscribed to the shared default topic sees what lands there. When a message about a private trip goes to the deployment default, the trip's name is left out. Because two users can share a topic, reminders are deduplicated per topic, not per user, so a shared stream never gets the same message twice. Messages follow the existing privacy floor: no booking references, passport numbers or document text, and no file names either, since confirmations are often saved under their reference number. Each message links to the relevant page through `AUTH_URL`.

**Reminders are scanned, not scheduled one by one.** A `reminder-sweep` job runs every five minutes, computes which reminders are due from the current segment data, records each one in a `notification_deliveries` table keyed by segment, kind, topic and event instant, and queues a `notify` job for new rows. Edits and deletions take effect on the next scan with nothing to cancel, and a rescheduled segment gets a fresh reminder because its event instant changed. The key uses the event rather than the fire time on purpose: the night rule and the fixed 20:00 and 09:00 reminders give many events the same fire time, so a flight moved from 06:00 to 07:30 after its 22:00 reminder still earns a corrected one. A row left `queued` for ten minutes (the worker died between writing it and queueing the send, or queueing failed) is handed back to the next sweep once. Reminder sends go on their own `notify-reminder` queue, created with pg-boss's `short` policy and keyed by delivery row, so if the first job was in fact still waiting the second is dropped rather than doubling the push. The existing `notify` queue can't take that policy, because pg-boss fixes a queue's policy at creation. A reminder more than 30 minutes overdue (the worker was down) is recorded as skipped rather than sent late, and nothing is sent once the event has started. The nightly prune drops delivery rows after 90 days. The rules, confirmed when the reminders were built (2026-10-21):

- **Lead times.** 24 hours and 4 hours before a flight, 3 hours before any train, bus, ferry, car or other transit leg, 3 hours before hotel check-in, and 1 hour before a timed activity or meal. Check-out is announced at 20:00 local time on the evening before. All are sent at ntfy's default priority. They are fixed for now, and each family (flights, transit, hotels, activities and food) can be switched off in Settings.
- **Night.** A lead-time reminder that would land between 23:00 and 07:00 local is moved to 22:00 the evening before, so titles carry the absolute time ("VN54 departs tomorrow 06:00") rather than a countdown.
- **No time.** A segment stored with a date but no time gets one reminder at 09:00 local on the day ("Check-in today", "Today: Fushimi Inari").
- **Connections.** A flight leg leaving within 12 hours of an earlier leg's arrival on the same booking (a shared PNR or linked document) gets no reminders of its own; the first leg's cover the journey.
- **Mute.** The per-trip mute is a button in the trip's action row, shown to every member who has notifications on and a topic to receive them, and only while the trip is planned or active. It silences only the person who pressed it.
- **Only planned and active trips** get reminders. A completed trip is over, and archived ones are shelved.
- **Midnight reads as "no time".** As everywhere else in Atlas, a segment stored at exactly 00:00 is treated as date-only and gets the 09:00 reminder, which for a real midnight departure arrives after it has left. Enter such a departure as 00:01 to get the lead-time reminders.

**Time zones for scheduling only.** A reminder converts the floating wall-clock to a real instant using a zone resolved per segment: the departure airport's zone for a flight (from the committed airport table), the zone at the pin's coordinates for everything else (an offline coordinate-to-zone lookup, no network; a transit leg only ever uses its origin's pin, never its destination's), the country's zone when the country has only one, and otherwise no reminder at all, with a log line saying why. A missing reminder is better than one that fires hours off. This is a narrow exception to ADR-0014 and ADR-0016: the resolved zone is used to decide when to send, never to render a time. Displayed times stay exactly as printed.

## Alternatives considered

**A random per-user topic generated on opt-in.** This was the original plan and gives each person a private stream with an unguessable name. It fails on a deny-by-default server, where Atlas has no right to write to a topic nobody granted, and topic secrecy adds nothing there. An operator-supplied default with a per-user override keeps separate streams possible without Atlas needing rights it cannot have.

**One deployment topic and nothing else.** Simpler, but a single shared stream could not keep a private trip private once a second person subscribes, and giving someone their own stream later would need a code change.

**A delayed pg-boss job per reminder.** pg-boss can hold a job until a start time, but every segment edit, reschedule or deletion would then have to find and cancel the right jobs. The scan derives reminders from current data every time, which matches how Atlas already treats derived state.

**Sending from the app process.** It would put the token and the network requirements on two containers instead of one, and tie request latency to the ntfy server.

**Web Push through the PWA.** It needs a push service, which on Android means Google's, plus key management and a subscription flow. ntfy keeps delivery on the household's own server.

## Consequences

- `users` gains `notifications_enabled`, `ntfy_topic` and `notification_prefs`. The reminder work adds `notification_deliveries`, `trip_notification_mutes` and two indexes on segment times for the sweep. All additive.
- Zone lookup adds one dependency, `@photostructure/tz-lookup` (offline, CC0), and a committed IANA country-to-zones snapshot in `src/lib/timezones/` with a refresh script (`scripts/fetch-country-zones.ts`). China is pinned to Asia/Shanghai, because tzdata also lists an informal Xinjiang zone (Asia/Urumqi) that would otherwise rule out the country fallback and put Xinjiang pins two hours off; bookings and timetables there use Beijing time. Places whose cached coordinates have expired by the time their reminders come up are re-geocoded by the sweep, days before anything is due.
- The worker needs `NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN` and `AUTH_URL`; the app needs only `NTFY_URL` and `NTFY_TOPIC`. A private-network ntfy host may need an `extra_hosts` entry on the worker, which belongs in the deployment's own compose file.
- Any signed-in user can point Atlas's publisher at any topic its token can write to, through the topic override. That is acceptable for a household, but it means the token should belong to a ntfy user dedicated to Atlas with write access to Atlas's topics only, never an admin or shared publisher token.
- A reminder can be up to five minutes late (the scan interval) and is dropped rather than delivered more than 30 minutes late. ntfy's own message cache bounds how long a phone can stay offline and still catch up.
- A non-flight segment with no pin and a multi-zone country gets no reminder. Pinning it fixes that.
- Delivery history lives in Postgres, so "did that reminder go out?" is answerable without scraping pg-boss's archive.
