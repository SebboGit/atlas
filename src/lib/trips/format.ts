// Shared trip date helpers. The full date-range form lived inside
// trip-list-card; it now lives here so the list card and the home
// next-trip hero render "12 – 23 Mar 2026" identically.

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
