import { Plane } from 'lucide-react';

import { displayCarrier, formatFlightNumber } from '@/lib/airlines';
import { getAirportTimezone } from '@/lib/airports';
import type { LinkedDocument } from '@/lib/documents';
import { formatTime, formatTimeWithZone } from '@/lib/format';
import type { Segment } from '@/lib/segments';
import { flightDataSchema } from '@/lib/segments';

import { LinkedDocumentChips } from './linked-document-chips';
import { SegmentCardShell } from './segment-card-shell';

/**
 * Calendar day at the supplied timezone, formatted as YYYY-MM-DD so two
 * days are comparable by string equality. Used by the `+1 day`
 * overnight indicator — that should reflect "the day on the boarding
 * pass", not "the day in the server's timezone."
 */
function dayInZone(d: Date, timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(d);
}

// A Date at exact local midnight signals "date-only, no time
// component" — the form's date picker parses a YYYY-MM-DD pick to
// 00:00 local, and the extraction mapper does the same. We treat
// these as "no time available" and skip the time meta to avoid
// rendering a meaningless "00:00". False-negative case: an
// honest-to-god midnight departure is hidden — acceptable, rare,
// and the user can fix by editing the segment.
function hasTimeComponent(d: Date | null): boolean {
  if (!d) return false;
  return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
}

/**
 * Render-side helper: produce the time string + optional TZ label for
 * one end of a flight. When the airport's TZ is known we format in
 * that zone and surface the label; otherwise we fall back to the
 * runtime zone with no label (no point claiming a TZ we don't know).
 */
function renderFlightEnd(
  d: Date | null,
  airportIata: string | undefined,
): { time: string; zone: string | null } | null {
  if (!hasTimeComponent(d)) return null;
  const tz = getAirportTimezone(airportIata ?? null);
  if (tz) {
    const { time, zone } = formatTimeWithZone(d!, { timeZone: tz });
    return { time, zone };
  }
  return { time: formatTime(d!), zone: null };
}

export function SegmentCardFlight({
  segment,
  linkedDocuments = [],
}: {
  segment: Segment;
  linkedDocuments?: LinkedDocument[];
}) {
  // Defensive parse — JSONB can technically hold anything historic
  // migrations left behind. A malformed segment should still render a
  // useful card rather than crash the whole itinerary.
  const parse = flightDataSchema.safeParse(segment.data);
  const data = parse.success ? parse.data : {};

  const origin = data.originAirport ?? '—';
  const destination = data.destinationAirport ?? '—';
  const title = `${origin} → ${destination}`;
  // displayCarrier resolves a stored IATA code ("VN") to the airline
  // name ("Vietnam Airlines"); names and unresolved codes pass through
  // unchanged. formatFlightNumber prepends the IATA designator to the
  // bare digits the extractor stores so the subtitle always carries
  // the canonical "WY 287" form alongside the friendly carrier name.
  // The flight number is rendered inside a whitespace-nowrap span so
  // "WY 287" never breaks across lines on narrow viewports.
  const carrierName = displayCarrier(data.carrier);
  const flightNum = formatFlightNumber(data.carrier, data.flightNumber);
  const subtitle =
    carrierName || flightNum ? (
      <>
        {carrierName}
        {carrierName && flightNum ? ' · ' : null}
        {flightNum ? <span className="whitespace-nowrap">{flightNum}</span> : null}
      </>
    ) : null;

  const depart = renderFlightEnd(segment.startsAt, data.originAirport);
  const arrive = renderFlightEnd(segment.endsAt, data.destinationAirport);

  // Overnight indicator compares calendar days at each end's local
  // timezone — what the boarding pass would print. Falls back to the
  // runtime zone when either airport's TZ is unknown.
  const departTz = getAirportTimezone(data.originAirport ?? null);
  const arriveTz = getAirportTimezone(data.destinationAirport ?? null);
  const overnight =
    segment.startsAt &&
    segment.endsAt &&
    dayInZone(segment.startsAt, departTz) !== dayInZone(segment.endsAt, arriveTz);

  const meta =
    depart || arrive ? (
      <div className="text-foreground/75 font-mono text-base leading-tight tracking-wider">
        {/* whitespace-nowrap on each time row keeps "12:30 UTC" together
            — without it the zone label can break onto its own line on
            narrow viewports, which reads as the time and zone being
            unrelated. */}
        <div className="whitespace-nowrap">
          {depart ? (
            <>
              {depart.time}
              {depart.zone && (
                <span className="text-foreground/40 ml-1 text-[10px] tracking-normal">
                  {depart.zone}
                </span>
              )}
            </>
          ) : (
            '—'
          )}
        </div>
        <div className="text-foreground/45 mt-1 flex items-baseline gap-1">
          <span>→</span>
          {arrive ? (
            <span className="whitespace-nowrap">
              {arrive.time}
              {overnight && <sup className="ml-0.5 text-[10px]">+1</sup>}
              {arrive.zone &&
                (overnight ? (
                  <span className="text-foreground/40 mt-0.5 block text-[10px] tracking-normal">
                    {arrive.zone}
                  </span>
                ) : (
                  <span className="text-foreground/40 ml-1 text-[10px] tracking-normal">
                    {arrive.zone}
                  </span>
                ))}
            </span>
          ) : (
            <span>—</span>
          )}
        </div>
      </div>
    ) : null;

  return (
    <SegmentCardShell
      glyph={<Plane className="size-4" strokeWidth={1.5} />}
      typeLabel="Flight"
      title={title}
      subtitle={subtitle ?? undefined}
      meta={meta}
      footer={
        linkedDocuments.length > 0 ? <LinkedDocumentChips documents={linkedDocuments} /> : undefined
      }
      needsReview={segment.needsReview}
      // Flights' meta is a two-line stacked time block — at 360px it
      // ran flush against the "JFK → LAX" headline. Stacking the meta
      // beneath the subtitle on mobile gives both elements room to
      // breathe; sm:+ reverts to the side-by-side layout shared with
      // the other segment variants.
      stackMetaOnMobile
    />
  );
}
