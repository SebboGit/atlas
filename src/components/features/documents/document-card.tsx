import { FileText, Image as ImageIcon, Paperclip } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { displayCarrier, formatFlightNumber } from '@/lib/airlines';
import type { DocumentWithLinks } from '@/lib/documents';
import { extractionState } from '@/lib/documents/state';
import { structuredPayloadSchema, type StructuredPayload } from '@/lib/extraction';
import { formatBytes, formatDate } from '@/lib/format';
import { formatMimeLabel } from '@/lib/storage/mimes';

import { DocumentDeleteButton } from './document-delete-button';
import { DocumentExtractButton } from './document-extract-button';
import { ParsedEditDialog } from './parsed-edit-dialog';

interface DocumentCardProps {
  document: DocumentWithLinks;
  tripId: string;
}

// One row in the Documents tab. Lightweight on purpose — the user is
// scanning a list, not absorbing a card. Click anywhere on the title
// link to open the document inline in a new tab.
export function DocumentCard({ document, tripId }: DocumentCardProps) {
  const typeLabel = formatMimeLabel(document.mime);
  const extracted = parseExtracted(document.parsed);

  return (
    <Card variant="paper" className="relative overflow-hidden">
      <CardContent className="flex flex-col gap-3 px-5 py-4 sm:gap-4 sm:px-6 sm:py-5">
        {/* The header keeps icon+title together as one unit and drops
            the action cluster (Extract / Download / Delete) onto its
            own row below on mobile. At 360px the three actions need
            ~200px of width, which left the title with ~20px to render
            in — broken either way. sm:+ goes back to a single row. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
            <div
              aria-hidden
              className="border-foreground/20 text-foreground/65 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border"
            >
              {renderIcon(document.mime)}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-foreground/55 font-mono text-[9px] tracking-[0.28em] uppercase">
                {typeLabel} · {formatBytes(document.bytes)}
              </p>
              <a
                href={`/api/documents/${document.id}?disposition=inline`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-display text-foreground hover:text-primary truncate text-[17px] leading-tight font-medium tracking-tight transition-colors"
                title={document.originalName}
              >
                {document.originalName}
              </a>
              <p className="text-muted-foreground font-mono text-[10px] tracking-wider">
                Added {formatRelative(document.createdAt)}
                {document.linkedSegmentCount > 0 && (
                  <span className="text-foreground/40"> · linked</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:shrink-0">
            <DocumentExtractButton
              tripId={tripId}
              documentId={document.id}
              state={extractionState(document)}
            />
            <a
              href={`/api/documents/${document.id}?disposition=attachment`}
              className="text-foreground/45 hover:text-foreground inline-flex h-8 items-center justify-center rounded-full px-3 font-mono text-[10px] tracking-[0.24em] uppercase transition-colors"
            >
              Download
            </a>
            <DocumentDeleteButton tripId={tripId} documentId={document.id} />
          </div>
        </div>

        {extracted && (
          <ExtractedSummary payload={extracted} tripId={tripId} documentId={document.id} />
        )}
      </CardContent>
    </Card>
  );
}

// Render the LLM's structured payload as a compact summary directly
// on the card. Without this block, a successful extract is invisible
// — the parsed JSON sits in the row but nothing surfaces it, so the
// user wonders "did anything happen?" Until ADR-0008 lands
// (auto-create segments from extraction), this is the only place the
// extracted facts are visible.
//
// Passenger name appears here as a secondary line for boarding-pass
// kinds — this is the canonical place to see who the document was
// for, especially useful when the same flight is uploaded for
// multiple travellers. It is intentionally NOT surfaced on segment
// renders (Itinerary / Flights tabs) when those land.
function ExtractedSummary({
  payload,
  tripId,
  documentId,
}: {
  payload: StructuredPayload;
  tripId: string;
  documentId: string;
}) {
  const primary = primarySummaryFor(payload);
  const secondary = secondarySummaryFor(payload);

  return (
    <div className="border-foreground/10 mt-1 flex items-start gap-3 border-t pt-3">
      <p
        aria-hidden
        className="text-foreground/55 mt-[1px] font-mono text-[9px] tracking-[0.28em] uppercase"
      >
        {kindLabel(payload.kind)}
      </p>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-foreground/85 text-sm leading-relaxed">{primary}</p>
        {secondary && <p className="text-muted-foreground text-xs leading-snug">{secondary}</p>}
      </div>
      {/* Trigger button lives inside ParsedEditDialog (client) — passing
       *  it as a JSX prop across the RSC → client boundary caused a
       *  hydration mismatch in the DialogTrigger asChild Slot. */}
      <ParsedEditDialog tripId={tripId} documentId={documentId} payload={payload} />
    </div>
  );
}

function primarySummaryFor(p: StructuredPayload): string {
  switch (p.kind) {
    case 'boarding-pass': {
      if (p.flights.length === 0) {
        return 'Flight document (no structured fields extracted).';
      }
      // Single-leg keeps the detailed line (carrier · route · date ·
      // confirmation). Multi-leg shows the full chain
      // (LHR → SFO → LHR) so the user sees the whole booking at a
      // glance — the per-leg carrier/flight numbers would crowd the
      // line and are still visible on the itinerary cards. The chain
      // is built by appending each leg's destination after the
      // previous, so a return trip naturally collapses to "A → B → A"
      // and a multi-city to "MUC → DXB → SGN".
      if (p.flights.length === 1) {
        const leg = p.flights[0]!;
        // NBSP inside "VN 287" so the IATA code and digits stay
        // together when the summary line wraps — without it, narrow
        // viewports show "VN" on one line and "287" on the next.
        const flightNum = formatFlightNumber(leg.carrier, leg.flightNumber);
        const flight = [displayCarrier(leg.carrier), flightNum?.replace(/ /g, ' ')]
          .filter(Boolean)
          .join(' ');
        const route = leg.origin && leg.destination ? `${leg.origin} → ${leg.destination}` : null;
        const date = leg.flightDate ? formatDate(leg.flightDate) : null;
        const parts = [flight || null, route, date, leg.confirmationCode].filter(Boolean);
        return parts.length > 0
          ? parts.join(' · ')
          : 'Flight document (no structured fields extracted).';
      }
      const chain = buildRouteChain(p.flights);
      const dates = buildDateSummary(p.flights);
      // The PNR is shared across legs of a single booking in
      // practice; surface whichever non-null one we find so the
      // summary stays useful even if the model missed it on leg 0.
      const pnr = p.flights.map((l) => l.confirmationCode).find((c) => c) ?? null;
      const parts = [chain, dates, pnr].filter(Boolean);
      return parts.length > 0
        ? parts.join(' · ')
        : 'Flight document (no structured fields extracted).';
    }
    case 'hotel-confirmation': {
      // En-dash for date ranges (typographic convention) so the date
      // field reads distinctly from the route arrows used elsewhere.
      const dates =
        p.checkIn && p.checkOut
          ? `${formatDate(p.checkIn)} – ${formatDate(p.checkOut)}`
          : p.checkIn
            ? formatDate(p.checkIn)
            : p.checkOut
              ? formatDate(p.checkOut)
              : null;
      const parts = [p.hotelName, dates, p.country, p.confirmationCode].filter(Boolean);
      return parts.length > 0
        ? parts.join(' · ')
        : 'Hotel confirmation (no structured fields extracted).';
    }
    case 'generic':
      return p.summary;
  }
}

// Walk the legs in order, emitting the origin chain followed by each
// destination. For a clean connection ("LHR → SFO" then "SFO → LHR")
// this collapses to "LHR → SFO → LHR". For an open-jaw or otherwise
// non-contiguous itinerary ("LHR → SFO" then "JFK → CDG") the
// previous destination doesn't equal the next origin, so we surface
// both — "LHR → SFO, JFK → CDG" — rather than fabricate a connection
// the booking doesn't describe. Legs missing an origin or destination
// are skipped from the chain entirely.
function buildRouteChain(
  flights: ReadonlyArray<{ origin: string | null; destination: string | null }>,
): string | null {
  const segments: Array<{ origin: string; destination: string }> = [];
  for (const leg of flights) {
    if (leg.origin && leg.destination) {
      segments.push({ origin: leg.origin, destination: leg.destination });
    }
  }
  if (segments.length === 0) return null;

  const groups: string[][] = [];
  let current: string[] = [];
  for (const seg of segments) {
    if (current.length === 0) {
      current.push(seg.origin, seg.destination);
    } else if (current[current.length - 1] === seg.origin) {
      current.push(seg.destination);
    } else {
      groups.push(current);
      current = [seg.origin, seg.destination];
    }
  }
  groups.push(current);
  return groups.map((g) => g.join(' → ')).join(', ');
}

// Multi-leg date summary. If every leg has the same date (a same-day
// connection), surface just that date; otherwise surface the first
// and last so the user sees the trip's span without scanning the
// whole itinerary. En-dash is the typographic convention for date
// ranges and keeps the dates visually distinct from the route
// arrows on the rest of the line.
function buildDateSummary(flights: ReadonlyArray<{ flightDate: string | null }>): string | null {
  const dates = flights.map((l) => l.flightDate).filter((d): d is string => d !== null);
  if (dates.length === 0) return null;
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  return first === last ? formatDate(first) : `${formatDate(first)} – ${formatDate(last)}`;
}

// Secondary line — currently only carries passenger name for
// boarding-passes. Returning `null` means no second line renders.
// Reads from the first leg; in practice every leg of a single
// booking is for the same passenger.
function secondarySummaryFor(p: StructuredPayload): string | null {
  if (p.kind === 'boarding-pass') {
    const leg = p.flights[0];
    if (leg?.passengerName) return `Passenger: ${leg.passengerName}`;
  }
  return null;
}

function kindLabel(kind: StructuredPayload['kind']): string {
  switch (kind) {
    case 'boarding-pass':
      return 'Flight';
    case 'hotel-confirmation':
      return 'Hotel';
    case 'generic':
      return 'Note';
  }
}

// `documents.parsed` is `unknown` JSONB. Validate before rendering —
// a stale row written by an older schema version would otherwise
// crash the card. On mismatch, return null and render nothing; the
// failure path is purely cosmetic so a silent skip is the right
// degradation.
function parseExtracted(raw: unknown): StructuredPayload | null {
  if (raw === null || raw === undefined) return null;
  const parsed = structuredPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// Returns rendered JSX rather than a component reference so we don't
// trip `react-hooks/static-components` on a dynamic component type at
// the call site.
function renderIcon(mime: string) {
  if (mime === 'application/pdf') return <FileText className="size-4" strokeWidth={1.5} />;
  if (mime.startsWith('image/')) return <ImageIcon className="size-4" strokeWidth={1.5} />;
  return <Paperclip className="size-4" strokeWidth={1.5} />;
}

// Tiny relative-time formatter — avoids pulling in an i18n library
// for a five-format use case. Good enough for "just now / 2h ago /
// 3d ago / Apr 23". Renders on the server (RSC) so no hydration
// drift concerns.
function formatRelative(d: Date): string {
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
