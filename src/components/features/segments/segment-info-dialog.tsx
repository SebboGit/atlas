'use client';

import {
  BedDouble,
  Bus,
  Car,
  Plane,
  Ship,
  Sparkles,
  StickyNote,
  TrainFront,
  UtensilsCrossed,
  Waypoints,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogEyebrow,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { displayCarrier, formatFlightNumber } from '@/lib/airlines';
import { getAirportTimezone } from '@/lib/airports';
import { countryName } from '@/lib/countries';
import type { LinkedDocument } from '@/lib/documents';
import { formatTimeWithZone } from '@/lib/format';
import type { Segment, TransitData } from '@/lib/segments';
import {
  activityDataSchema,
  flightDataSchema,
  foodDataSchema,
  hotelDataSchema,
  noteDataSchema,
  transitDataSchema,
} from '@/lib/segments';
import { cn } from '@/lib/utils';

import { LinkedDocumentChips } from './linked-document-chips';

interface SegmentInfoDialogProps {
  segment: Segment;
  linkedDocuments?: LinkedDocument[];
  children: React.ReactNode;
}

// Read-only inspector for a single segment. The clickable surface is
// the segment card itself; clicks that land on a nested anchor or
// button (document chips, the edit / delete / schedule cluster) are
// ignored so those affordances keep their own behaviour.
export function SegmentInfoDialog({
  segment,
  linkedDocuments = [],
  children,
}: SegmentInfoDialogProps) {
  const [open, setOpen] = React.useState(false);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    // `closest` walks up from the target — and the wrapper itself
    // carries `role="button"`, so it would always match. Scope the
    // search to nested controls only: a hit equal to the wrapper means
    // the click landed on the card surface, not a real nested affordance.
    const interactive = target?.closest('a, button, [role="button"]');
    if (interactive && interactive !== e.currentTarget) return;
    setOpen(true);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Only react when focus is on the wrapper itself — Enter / Space
    // inside a nested control would otherwise double-fire (the
    // control's own activation plus our dialog open).
    // Strict `e.target` identity is deliberate here (unlike the
    // `closest()` walk in handleClick): keyboard activation already
    // targets the focused element, so a focused nested anchor/button
    // gets its own native activation and this wrapper correctly bails —
    // no ancestor walk is needed to tell card surface from nested control.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={triggerLabel(segment)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          'group rounded-2xl outline-none',
          'cursor-pointer transition-[transform,box-shadow] duration-200',
          'hover:-translate-y-px hover:shadow-[0_28px_60px_-30px_rgba(60,40,20,0.32)]',
          'focus-visible:ring-primary/40 focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2',
        )}
      >
        {children}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          aria-describedby={undefined}
          className="gap-5 sm:p-6"
        >
          <SegmentInfoBody segment={segment} linkedDocuments={linkedDocuments} />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Body — dispatches on segment.type. Notes have their own minimal layout
// because their content IS the body, not a structured key-value list.
// ---------------------------------------------------------------------------

function SegmentInfoBody({
  segment,
  linkedDocuments,
}: {
  segment: Segment;
  linkedDocuments: LinkedDocument[];
}) {
  switch (segment.type) {
    case 'flight':
      return <FlightInfoBody segment={segment} linkedDocuments={linkedDocuments} />;
    case 'hotel':
      return <HotelInfoBody segment={segment} linkedDocuments={linkedDocuments} />;
    case 'activity':
      return <ActivityInfoBody segment={segment} linkedDocuments={linkedDocuments} />;
    case 'transit':
      return <TransitInfoBody segment={segment} linkedDocuments={linkedDocuments} />;
    case 'food':
      return <FoodInfoBody segment={segment} linkedDocuments={linkedDocuments} />;
    case 'note':
      return <NoteInfoBody segment={segment} />;
  }
}

// ---------------------------------------------------------------------------
// Per-type bodies
// ---------------------------------------------------------------------------

function FlightInfoBody({
  segment,
  linkedDocuments,
}: {
  segment: Segment;
  linkedDocuments: LinkedDocument[];
}) {
  const parse = flightDataSchema.safeParse(segment.data);
  const data = parse.success ? parse.data : {};

  const origin = data.originAirport ?? '—';
  const destination = data.destinationAirport ?? '—';
  const carrierName = displayCarrier(data.carrier);
  const flightNum = formatFlightNumber(data.carrier, data.flightNumber);

  const departTz = getAirportTimezone(data.originAirport ?? null);
  const arriveTz = getAirportTimezone(data.destinationAirport ?? null);
  const depart = describeInstant(segment.startsAt, departTz);
  const arrive = describeInstant(segment.endsAt, arriveTz);
  const overnight = depart && arrive && depart.date !== arrive.date;

  return (
    <>
      <InfoHeader
        eyebrow="Flight"
        title={`${origin} → ${destination}`}
        subtitle={
          carrierName || flightNum
            ? [carrierName, flightNum].filter(Boolean).join(' · ')
            : undefined
        }
      />

      {(depart || arrive) && (
        <InfoSection title="Schedule">
          <FlightLeg label="Depart" iata={data.originAirport} instant={depart} />
          <FlightLeg
            label="Arrive"
            iata={data.destinationAirport}
            instant={arrive}
            overnight={Boolean(overnight)}
          />
        </InfoSection>
      )}

      {(data.pnr || data.seat || data.flightNumber) && (
        <InfoSection title="Booking">
          <InfoRow label="Flight" value={flightNum} mono />
          <InfoRow label="PNR" value={data.pnr} mono />
          <InfoRow label="Seat" value={data.seat} mono />
        </InfoSection>
      )}

      {(segment.originCountryCode || segment.countryCode) && (
        <InfoSection title="Countries">
          <InfoRow label="From" value={resolveCountry(segment.originCountryCode)} />
          <InfoRow label="To" value={resolveCountry(segment.countryCode)} />
        </InfoSection>
      )}

      <DocumentsFooter documents={linkedDocuments} />
    </>
  );
}

function HotelInfoBody({
  segment,
  linkedDocuments,
}: {
  segment: Segment;
  linkedDocuments: LinkedDocument[];
}) {
  const parse = hotelDataSchema.safeParse(segment.data);
  const data = parse.success ? parse.data : null;
  const title = data?.propertyName ?? 'Hotel';

  const checkIn = describeInstant(segment.startsAt, null);
  const checkOut = describeInstant(segment.endsAt, null);
  const nights =
    segment.startsAt && segment.endsAt
      ? Math.max(
          1,
          Math.round(
            (segment.endsAt.getTime() - segment.startsAt.getTime()) / (1000 * 60 * 60 * 24),
          ),
        )
      : null;

  return (
    <>
      <InfoHeader eyebrow="Hotel" title={title} subtitle={data?.roomType ?? undefined} />

      <InfoSection title="Stay">
        <InfoRow label="Check-in" value={formatInstant(checkIn)} mono />
        <InfoRow label="Check-out" value={formatInstant(checkOut)} mono />
        {nights !== null && (
          <InfoRow label="Nights" value={`${nights} night${nights === 1 ? '' : 's'}`} />
        )}
      </InfoSection>

      {(segment.locationName || data?.address || segment.countryCode) && (
        <InfoSection title="Location">
          <InfoRow label="Place" value={segment.locationName} />
          <InfoRow label="Address" value={data?.address} multiline />
          <InfoRow label="Country" value={resolveCountry(segment.countryCode)} />
        </InfoSection>
      )}

      {data?.confirmationNumber && (
        <InfoSection title="Booking">
          <InfoRow label="Confirmation" value={data.confirmationNumber} mono />
        </InfoSection>
      )}

      <DocumentsFooter documents={linkedDocuments} />
    </>
  );
}

function ActivityInfoBody({
  segment,
  linkedDocuments,
}: {
  segment: Segment;
  linkedDocuments: LinkedDocument[];
}) {
  const parse = activityDataSchema.safeParse(segment.data);
  const title = parse.success ? parse.data.title : 'Activity';
  const description = parse.success ? parse.data.description : undefined;
  const bookingRef = parse.success ? parse.data.bookingRef : undefined;

  const isWishlist = segment.startsAt === null;
  const startsAt = describeInstant(segment.startsAt, null);
  const endsAt = describeInstant(segment.endsAt, null);

  return (
    <>
      <InfoHeader
        eyebrow="Activity"
        title={title}
        subtitle={
          isWishlist ? (
            <span className="border-foreground/25 text-foreground/65 inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.24em] uppercase">
              Wishlist
            </span>
          ) : undefined
        }
      />

      {description && (
        <InfoSection title="Details">
          <p className="text-foreground/85 text-sm leading-relaxed whitespace-pre-wrap">
            {description}
          </p>
        </InfoSection>
      )}

      {!isWishlist && (startsAt || endsAt) && (
        <InfoSection title="When">
          <InfoRow label="Start" value={formatInstant(startsAt)} mono />
          <InfoRow label="End" value={formatInstant(endsAt)} mono />
        </InfoSection>
      )}

      {(segment.locationName || segment.countryCode) && (
        <InfoSection title="Location">
          <InfoRow label="Place" value={segment.locationName} />
          <InfoRow label="Country" value={resolveCountry(segment.countryCode)} />
        </InfoSection>
      )}

      {bookingRef && (
        <InfoSection title="Booking">
          <InfoRow label="Reference" value={bookingRef} mono />
        </InfoSection>
      )}

      <DocumentsFooter documents={linkedDocuments} />
    </>
  );
}

const TRANSIT_ICON: Record<TransitData['mode'], LucideIcon> = {
  train: TrainFront,
  bus: Bus,
  ferry: Ship,
  car: Car,
  other: Waypoints,
};

const TRANSIT_LABEL: Record<TransitData['mode'], string> = {
  train: 'Train',
  bus: 'Bus',
  ferry: 'Ferry',
  car: 'Car',
  other: 'Transit',
};

function TransitInfoBody({
  segment,
  linkedDocuments,
}: {
  segment: Segment;
  linkedDocuments: LinkedDocument[];
}) {
  const parse = transitDataSchema.safeParse(segment.data);
  const data = parse.success ? parse.data : { mode: 'other' as const };
  const label = TRANSIT_LABEL[data.mode];

  const titleParts = [data.fromName, data.toName].filter(Boolean);
  const title =
    titleParts.length === 2 ? `${titleParts[0]} → ${titleParts[1]}` : (titleParts[0] ?? label);

  const startsAt = describeInstant(segment.startsAt, null);
  const endsAt = describeInstant(segment.endsAt, null);

  const Glyph = TRANSIT_ICON[data.mode];

  return (
    <>
      <InfoHeader
        eyebrow={label}
        title={title}
        subtitle={data.carrier ?? undefined}
        glyph={Glyph}
      />

      {(startsAt || endsAt) && (
        <InfoSection title="Schedule">
          <InfoRow label="Depart" value={formatInstant(startsAt)} mono />
          <InfoRow label="Arrive" value={formatInstant(endsAt)} mono />
        </InfoSection>
      )}

      {(data.fromName || data.toName || data.referenceNumber) && (
        <InfoSection title="Route">
          <InfoRow label="From" value={data.fromName} />
          <InfoRow label="To" value={data.toName} />
          <InfoRow label="Reference" value={data.referenceNumber} mono />
        </InfoSection>
      )}

      {(segment.locationName || segment.countryCode) && (
        <InfoSection title="Location">
          <InfoRow label="Place" value={segment.locationName} />
          <InfoRow label="Country" value={resolveCountry(segment.countryCode)} />
        </InfoSection>
      )}

      <DocumentsFooter documents={linkedDocuments} />
    </>
  );
}

function FoodInfoBody({
  segment,
  linkedDocuments,
}: {
  segment: Segment;
  linkedDocuments: LinkedDocument[];
}) {
  const parse = foodDataSchema.safeParse(segment.data);
  const data = parse.success ? parse.data : null;
  const title = data?.venue ?? 'Meal';
  const bookingRef = data?.bookingRef;

  const startsAt = describeInstant(segment.startsAt, null);
  const endsAt = describeInstant(segment.endsAt, null);

  return (
    <>
      <InfoHeader eyebrow="Food" title={title} glyph={UtensilsCrossed} />

      {(startsAt || endsAt) && (
        <InfoSection title="When">
          <InfoRow label="Reservation" value={formatInstant(startsAt)} mono />
          {endsAt && <InfoRow label="Ends" value={formatInstant(endsAt)} mono />}
        </InfoSection>
      )}

      {(segment.locationName || data?.address || segment.countryCode) && (
        <InfoSection title="Location">
          <InfoRow label="Place" value={segment.locationName} />
          <InfoRow label="Address" value={data?.address} multiline />
          <InfoRow label="Country" value={resolveCountry(segment.countryCode)} />
        </InfoSection>
      )}

      {bookingRef && (
        <InfoSection title="Booking">
          <InfoRow label="Reference" value={bookingRef} mono />
        </InfoSection>
      )}

      <DocumentsFooter documents={linkedDocuments} />
    </>
  );
}

function NoteInfoBody({ segment }: { segment: Segment }) {
  const parse = noteDataSchema.safeParse(segment.data);
  const body = parse.success ? parse.data.body : '';
  const when = describeInstant(segment.startsAt, null);

  return (
    <>
      <DialogHeader className="gap-2">
        <DialogEyebrow>
          <StickyNote className="size-3.5" strokeWidth={1.5} />
          <span>Note</span>
          {when && <span className="text-foreground/45">{formatInstant(when)}</span>}
        </DialogEyebrow>
      </DialogHeader>
      <p className="text-foreground/90 text-base leading-relaxed whitespace-pre-wrap">
        {body || '—'}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

const TYPE_GLYPH: Record<Segment['type'], LucideIcon> = {
  flight: Plane,
  hotel: BedDouble,
  activity: Sparkles,
  transit: Waypoints,
  food: UtensilsCrossed,
  note: StickyNote,
};

function InfoHeader({
  eyebrow,
  title,
  subtitle,
  glyph,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  // Explicit glyph wins (transit passes its mode-specific icon).
  // Otherwise we look the eyebrow up against the segment-type table —
  // covers flight / hotel / activity / note.
  glyph?: LucideIcon;
}) {
  const fallback = TYPE_GLYPH[eyebrow.toLowerCase() as Segment['type']] ?? Waypoints;
  const Glyph = glyph ?? fallback;
  return (
    <DialogHeader className="gap-2">
      <DialogEyebrow>
        <Glyph className="size-3.5" strokeWidth={1.5} />
        <span>{eyebrow}</span>
      </DialogEyebrow>
      <DialogTitle className="text-2xl break-words">{title}</DialogTitle>
      {subtitle && <p className="text-muted-foreground text-sm leading-relaxed">{subtitle}</p>}
    </DialogHeader>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  // Only render the section when at least one row inside it has a
  // value — null InfoRow rows render nothing, so an "all-empty"
  // section would otherwise leave a stranded header. We can't peek
  // at children's output, but the per-type bodies above already gate
  // each section on "any of the relevant fields exist" so this stays
  // a presentation primitive.
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-foreground/55 font-mono text-[10px] tracking-[0.28em] uppercase">
        {title}
      </h4>
      <dl className="border-foreground/10 divide-foreground/8 divide-y rounded-xl border">
        {children}
      </dl>
    </section>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
  multiline = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  multiline?: boolean;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div
      className={cn(
        'flex gap-4 px-4 py-2.5',
        multiline ? 'flex-col gap-1 sm:flex-row sm:gap-4' : 'items-baseline',
      )}
    >
      <dt className="text-foreground/55 w-24 shrink-0 font-mono text-[10px] tracking-[0.2em] uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          'text-foreground/90 min-w-0 flex-1 text-sm leading-relaxed',
          mono && 'font-mono tracking-wider',
          multiline && 'whitespace-pre-wrap',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function DocumentsFooter({ documents }: { documents: LinkedDocument[] }) {
  if (documents.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-foreground/55 font-mono text-[10px] tracking-[0.28em] uppercase">
        Documents
      </h4>
      <LinkedDocumentChips documents={documents} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InstantParts {
  date: string;
  time: string | null;
  zone: string | null;
}

// A Date at exact local midnight signals "date-only, no time
// component" — same convention as the segment cards. Hide the time
// row in that case rather than printing "00:00".
function hasTimeComponent(d: Date): boolean {
  return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function describeInstant(d: Date | null, tz: string | null): InstantParts | null {
  if (!d) return null;
  const date = tz
    ? new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: tz,
      }).format(d)
    : DATE_FMT.format(d);
  if (!hasTimeComponent(d)) return { date, time: null, zone: null };
  if (tz) {
    const { time, zone } = formatTimeWithZone(d, { timeZone: tz });
    return { date, time, zone };
  }
  return {
    date,
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
    zone: null,
  };
}

function formatInstant(parts: InstantParts | null): string | null {
  if (!parts) return null;
  if (!parts.time) return parts.date;
  return parts.zone
    ? `${parts.date} · ${parts.time} ${parts.zone}`
    : `${parts.date} · ${parts.time}`;
}

function resolveCountry(code: string | null | undefined): string | null {
  if (!code) return null;
  return countryName(code);
}

function FlightLeg({
  label,
  iata,
  instant,
  overnight = false,
}: {
  label: string;
  iata: string | undefined;
  instant: InstantParts | null;
  overnight?: boolean;
}) {
  if (!iata && !instant) return null;
  return (
    <div className="flex gap-4 px-4 py-3">
      <dt className="text-foreground/55 w-20 shrink-0 font-mono text-[10px] tracking-[0.2em] uppercase">
        {label}
      </dt>
      <dd className="min-w-0 flex-1">
        <div className="text-foreground font-mono text-base tracking-wider">
          {iata ?? '—'}
          {overnight && (
            <sup className="text-foreground/55 ml-1 font-sans text-[10px] normal-case">+1</sup>
          )}
        </div>
        {instant && (
          <div className="text-foreground/65 mt-0.5 text-xs">
            <span className="font-mono tracking-wider">
              {instant.date}
              {instant.time ? (
                <>
                  <span className="text-foreground/35"> · </span>
                  {instant.time}
                  {instant.zone && (
                    <span className="text-foreground/45 ml-1 text-[10px]">{instant.zone}</span>
                  )}
                </>
              ) : null}
            </span>
          </div>
        )}
      </dd>
    </div>
  );
}

function triggerLabel(segment: Segment): string {
  switch (segment.type) {
    case 'flight':
      return 'View flight details';
    case 'hotel':
      return 'View stay details';
    case 'activity':
      return 'View activity details';
    case 'transit':
      return 'View transit details';
    case 'food':
      return 'View food details';
    case 'note':
      return 'View note';
  }
}
