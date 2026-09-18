// Shared trip date helpers. The full date-range form lived inside
// trip-list-card; it now lives here so the list card and the home
// next-trip hero render "12 Mar – 23 Mar 2026" identically.

export function formatTripDateRange(start: Date | null, end: Date | null): string {
  if (!start && !end) return 'Dates to come';

  // Date-only inputs are stored as UTC midnight (see toYmd below), so format
  // in UTC too — otherwise a viewer west of Greenwich sees the prior day.
  const fmtDay = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fmtYear = (d: Date) => d.getUTCFullYear().toString();
  const fmtFull = (d: Date) =>
    d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

  if (start && end) {
    const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
    return sameYear
      ? `${fmtDay(start)} – ${fmtDay(end)} ${fmtYear(end)}`
      : `${fmtFull(start)} – ${fmtFull(end)}`;
  }
  if (start) return `From ${fmtFull(start)}`;
  return `Until ${fmtFull(end!)}`;
}

// The trip-detail header's fuller form — weekday included, the two ends
// joined by an arrow ("Sun, 4 Oct 2026 → Mon, 12 Oct 2026"). Lives here
// rather than in the header component so it gets the same UTC treatment
// as the range above: trip dates are UTC-midnight day tokens, so a
// viewer west of Greenwich would otherwise read the day before — and,
// because the server renders in UTC and the browser re-renders locally,
// every trip page would log a hydration mismatch (ADR-0014/0016).
export function formatTripDateSpan(start: Date | null, end: Date | null): string {
  const fmtFull = (d: Date) =>
    d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

  if (start && end) return `${fmtFull(start)} → ${fmtFull(end)}`;
  if (start) return `From ${fmtFull(start)}`;
  if (end) return `Until ${fmtFull(end)}`;
  return 'Dates to come';
}

// The phone trip-list row's form — uppercased, month-abbreviated, no
// weekday ("4 OCT – 12 OCT 2026"). Narrower than the range above because
// a phone row gives it one line next to a status dot and a chevron. UTC
// for the same reason as its two siblings.
export function formatTripCompactRange(start: Date | null, end: Date | null): string {
  if (!start && !end) return 'Dates TBC';

  const fmtDay = (d: Date) =>
    d
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .toUpperCase();
  const fmtYear = (d: Date) => d.getUTCFullYear().toString();

  if (start && end) {
    const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
    return sameYear
      ? `${fmtDay(start)} – ${fmtDay(end)} ${fmtYear(end)}`
      : `${fmtDay(start)} ${fmtYear(start)} – ${fmtDay(end)} ${fmtYear(end)}`;
  }
  if (start) return `From ${fmtDay(start)} ${fmtYear(start)}`;
  return `Until ${fmtDay(end!)} ${fmtYear(end!)}`;
}

// A date's calendar day as a timezone-independent `YYYY-MM-DD` token.
// Date-only inputs are stored as UTC midnight (trips/validators parses the
// 'yyyy-mm-dd' form via `new Date('yyyy-mm-dd')`, which is UTC), so the UTC
// Y/M/D is the intended calendar date — read it with the UTC getters so the
// token is independent of the server's timezone. Safe to hand to the client,
// which does the relative-day math against the VIEWER's own "today".
// Relative-day displays (countdown, day-of-trip) are computed client-side on
// purpose: the server's timezone isn't the viewer's.
export function toYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
