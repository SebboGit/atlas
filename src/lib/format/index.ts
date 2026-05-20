// Shared display formatters. Lifted out of feature components when the
// same function appeared in three or more places — keep this module
// boring: no dependencies on the rest of the app, no React.

/**
 * Wall-clock time in 24-hour format (en-GB). Used on segment cards
 * (flights, transit, activities) where seconds are noise.
 *
 * The optional `timeZone` argument is the canonical IANA identifier
 * (e.g. "Asia/Saigon") and produces the wall-clock time AT that
 * timezone — what someone standing at the airport would read off
 * their watch. Omit `timeZone` to fall back to the runtime's local
 * zone (RSC: the server's timezone). Flight cards pass the airport's
 * timezone so an SGN arrival reads "04:40" regardless of where the
 * server is hosted.
 */
export function formatTime(d: Date, options?: { timeZone?: string }): string {
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(options?.timeZone ? { timeZone: options.timeZone } : {}),
  });
}

/**
 * Wall-clock time + a short timezone label (e.g. "04:40 ICT") so the
 * reader can tell which timezone the time is reported in. Uses
 * `formatToParts` because the locale machinery can emit non-ASCII
 * separators ("04:40 GMT+7") that we want to control. Returns just
 * the bare time when `timeZone` is omitted — for those cards there's
 * no second TZ to disambiguate against.
 *
 * Returns `{ time, zone }` so callers can lay out the parts (e.g.
 * stacked or with different type treatment) without re-parsing.
 */
export function formatTimeWithZone(
  d: Date,
  options: { timeZone: string },
): { time: string; zone: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: options.timeZone,
    timeZoneName: 'short',
  }).formatToParts(d);
  // Pull the time fragment (hour:minute) and the zone label separately.
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  const zone = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  return {
    time: `${hour}:${minute}`,
    zone,
  };
}

// Internal: pull the calendar parts of a Date as observed in `tz`.
// Hour cycle is forced to h23 so midnight comes back as 00 rather
// than the en-GB quirk that occasionally returns 24.
function partsInZone(
  d: Date,
  tz: string,
): { y: number; m: number; day: number; h: number; min: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    y: get('year'),
    m: get('month'),
    day: get('day'),
    h: get('hour'),
    min: get('minute'),
    s: get('second'),
  };
}

/**
 * Format a Date as a wall-clock string in the supplied IANA timezone:
 *   - 'yyyy-mm-dd'         when the instant lands on midnight in `tz`
 *   - 'yyyy-mm-ddThh:mm'   otherwise
 *
 * Used by the segment form to display arrival / departure times in
 * the relevant airport's timezone — what the boarding pass shows.
 * Without this, an SGN arrival stored as 21:40 UTC renders as 23:40
 * for a CEST-local user, which is technically correct but practically
 * confusing.
 */
export function formatLocalDateTimeInZone(d: Date, tz: string): string {
  const p = partsInZone(d, tz);
  const yyyy = String(p.y).padStart(4, '0');
  const mm = String(p.m).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  if (p.h === 0 && p.min === 0 && p.s === 0) return `${yyyy}-${mm}-${dd}`;
  const hh = String(p.h).padStart(2, '0');
  const mn = String(p.min).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mn}`;
}

/**
 * Inverse of formatLocalDateTimeInZone: parse a wall-clock string
 * (`yyyy-mm-dd` or `yyyy-mm-ddThh:mm`) interpreted at the supplied
 * IANA timezone and return the corresponding UTC instant. Returns
 * null on malformed input.
 *
 * Implementation: assemble a UTC instant from the literal parts, then
 * compute that instant's wall-clock in `tz`, take the difference (=
 * the zone's offset at that moment, including DST), and shift the
 * naive instant by that amount. One Intl round-trip; correct across
 * DST transitions because the offset is computed at the candidate
 * instant.
 */
export function dateFromLocalInZone(s: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = m[4] ? Number(m[4]) : 0;
  const mi = m[5] ? Number(m[5]) : 0;
  const naiveUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0);
  const observed = partsInZone(new Date(naiveUtcMs), tz);
  const observedAsUtcMs = Date.UTC(
    observed.y,
    observed.m - 1,
    observed.day,
    observed.h,
    observed.min,
    observed.s,
  );
  const offsetMs = observedAsUtcMs - naiveUtcMs;
  return new Date(naiveUtcMs - offsetMs);
}

/**
 * Human-readable byte count. 0–1023 in B, KB to one decimal places
 * round-up, MB with one decimal. We never go above MB in this app
 * (STORAGE_MAX_BYTES caps at 20 MB by default).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Calendar-date formatting (raw ISO YYYY-MM-DD strings)
// ---------------------------------------------------------------------------

export type DateFormatMode = 'iso' | 'eu' | 'us';

/**
 * Resolve the active date-format mode from the environment. Reads
 * `NEXT_PUBLIC_ATLAS_DATE_FORMAT` — `NEXT_PUBLIC_` so Next.js inlines
 * the value into the client bundle and server-rendered output picks
 * up the same setting. Unknown / unset values fall back to `iso`.
 *
 * Pure read — no caching — so tests can stub `process.env` per case.
 */
export function getDateFormatMode(): DateFormatMode {
  const raw = process.env.NEXT_PUBLIC_ATLAS_DATE_FORMAT?.toLowerCase().trim();
  if (raw === 'eu' || raw === 'us') return raw;
  return 'iso';
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Format a calendar date (an ISO `YYYY-MM-DD` string — no time
 * component) for display. Switches between the three formats the
 * env var allows:
 *
 *   - `iso` (default): `2026-02-19`
 *   - `eu`:            `19/02/2026`
 *   - `us`:            `02/19/2026`
 *
 * Intentionally **not** locale-aware. The locale-aware formatter
 * (`"Mon, 1 Jun 2026"`) used for trip headers stays untouched —
 * this helper covers the raw-ISO surfaces that previously rendered
 * the date verbatim (document card summaries, hotel check-in /
 * check-out, multi-leg date ranges).
 *
 * Returns the input unchanged on malformed strings — the caller is
 * usually rendering an extraction payload it doesn't fully trust,
 * and a passthrough is more useful than an exception or a blank.
 */
export function formatDate(iso: string, mode: DateFormatMode = getDateFormatMode()): string {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) return iso;
  const [, yyyy, mm, dd] = m;
  if (mode === 'eu') return `${dd}/${mm}/${yyyy}`;
  if (mode === 'us') return `${mm}/${dd}/${yyyy}`;
  return `${yyyy}-${mm}-${dd}`;
}
