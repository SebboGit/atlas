// Shared trip date helpers. The full date-range form lived inside
// trip-list-card; it now lives here so the list card and the home
// next-trip hero render "12 – 23 Mar 2026" identically.

export function formatTripDateRange(start: Date | null, end: Date | null): string {
  if (!start && !end) return 'Dates to come';

  const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fmtYear = (d: Date) => d.getUTCFullYear().toString();
  const fmtFull = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

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
// Date-only inputs are stored as local midnight (see trips/validators), so
// the server's local Y/M/D is the intended calendar date — safe to hand to
// the client, which does the relative-day math against the VIEWER's own
// "today". Relative-day displays (countdown, day-of-trip) are computed
// client-side on purpose: the server's timezone isn't the viewer's.
export function toYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
