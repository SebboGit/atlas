import { Plane } from 'lucide-react';

import { displayCarrier, formatFlightNumber } from '@/lib/airlines';
import { getAirportTimezone } from '@/lib/airports';
import type { LinkedDocument } from '@/lib/documents';
import { formatTime, zoneAbbreviation } from '@/lib/format';
import type { Segment } from '@/lib/segments';
import { flightDataSchema } from '@/lib/segments';

import { LinkedDocumentChips } from './linked-document-chips';
import { SegmentCardShell } from './segment-card-shell';

// A Date at exact UTC midnight signals "date-only, no time component" —
// the form's date picker and the extraction mapper both parse a bare
// YYYY-MM-DD to 00:00 UTC (floating local, ADR-0014/0016). We treat
// these as "no time available" and skip the time meta to avoid rendering
// a meaningless "00:00". False-negative case: a genuine midnight
// departure (00:00 airport-local) is hidden — acceptable, rare, and the
// user can fix by editing the segment.
function hasTimeComponent(d: Date | null): boolean {
  if (!d) return false;
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
}

// UTC calendar day as YYYY-MM-DD, comparable by string equality. Flight
// times are floating-UTC (ADR-0016), so the day a flight "reads" is its
// UTC calendar day — the same key the itinerary buckets on.
function utcDay(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Render-side helper: produce the time string + optional zone LABEL for
 * one end of a flight. The stored instant is a floating-UTC wall clock
 * (ADR-0016), so we render it verbatim in UTC and tag it with the
 * airport's zone abbreviation (no clock conversion). Unknown airport →
 * no label rather than claiming a zone we don't have.
 */
function renderFlightEnd(
  d: Date | null,
  airportIata: string | undefined,
): { time: string; zone: string | null } | null {
  if (!hasTimeComponent(d)) return null;
  const time = formatTime(d!, { timeZone: 'UTC' });
  const tz = getAirportTimezone(airportIata ?? null);
  return { time, zone: tz ? zoneAbbreviation(d!, tz) : null };
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

  // Overnight indicator compares the printed calendar day at each end.
  // Both instants are floating-UTC wall clocks (ADR-0016), so their UTC
  // dates ARE the boarding-pass dates — no zone conversion needed.
  const overnight =
    segment.startsAt && segment.endsAt && utcDay(segment.startsAt) !== utcDay(segment.endsAt);

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
      type="flight"
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
