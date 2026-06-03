'use client';

import { useMounted } from '@/components/client-only';
import { formatTime } from '@/lib/format';

// A wall-clock time rendered in the VIEWER's local timezone.
//
// Non-flight segment times are stored as a wall-clock interpreted in the
// browser's zone at entry (shared-date-fields passes no tz, so the form's
// resolver parses the naive string in local time). The server's zone isn't
// the viewer's, so formatting on the server would both show the wrong hour
// and mismatch hydration against the client. We resolve on mount instead —
// the same getServerSnapshot:false pattern as the home countdown — and show
// a stable, same-width placeholder until then. Flight cards pass an explicit
// airport tz (formatTimeWithZone) and never use this.
export function LocalTime({ date }: { date: Date }) {
  const mounted = useMounted();
  return <>{mounted ? formatTime(date) : '––:––'}</>;
}
