'use client';

import { Pencil } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { DateTimeField } from '@/components/ui/date-time-field';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateParsedAction } from '@/lib/documents/actions';
import type { StructuredPayload } from '@/lib/extraction';
import { cn } from '@/lib/utils';

interface ParsedEditDialogProps {
  tripId: string;
  documentId: string;
  payload: StructuredPayload;
}

// Inline edit for the extracted `parsed` payload. Re-extract is the
// LLM round-trip path (slow, broad); this dialog is the fast-fix
// path for individual fields the model got slightly wrong.
//
// Fields are kind-specific. `confidence` is preserved (not shown)
// so the audit story stays accurate; `kind` is locked (the user
// can't reclassify a document inline — re-extract is the path for
// that).
//
// Visual language matches `SegmentForm` — short labels, examples in
// placeholders, project DatePicker (not the browser native), tight
// grid. Anything wider felt clunky alongside the segment form on
// the same trip page.
export function ParsedEditDialog({ tripId, documentId, payload }: ParsedEditDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  // Per-field validation errors from the server. Keys are dotted
  // Zod paths — e.g. "flights.0.carrier", "checkIn", "summary".
  // BoardingPassFields strips its leg prefix before passing keys
  // down to Field; hotel and generic look up by simple key. Rebuilt
  // on every submit; cleared when the dialog opens.
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  // Local form state seeded from the current payload. Re-seed only
  // when the dialog opens (via onOpenChange) so reopening after a
  // save shows the new values, and reopening after a cancel
  // discards the unsaved edits. State changes live in the event
  // handler to satisfy `react-hooks/set-state-in-effect` (project
  // rule: no setState inside effects).
  const [draft, setDraft] = React.useState<StructuredPayload>(payload);
  // Active leg for boarding-pass payloads. Lifted here (rather than
  // owned inside BoardingPassFields) so a submit-time validation
  // failure can jump straight to the leg with the offending field —
  // otherwise a user could land on a clean tab with no idea why save
  // failed.
  const [activeLegIndex, setActiveLegIndex] = React.useState(0);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setDraft(payload);
      setError(null);
      setFieldErrors({});
      setActiveLegIndex(0);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateParsedAction(tripId, documentId, draft);
      if (!result.ok) {
        setError(result.error.formMessage ?? 'Could not save changes.');
        const fields = result.error.fields ?? {};
        setFieldErrors(fields);
        if (draft.kind === 'boarding-pass') {
          const firstErrored = firstLegWithError(fields, draft.flights.length);
          if (firstErrored !== null) setActiveLegIndex(firstErrored);
        }
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Edit extracted data"
          className="border-foreground/15 bg-card/70 text-foreground/70 hover:bg-card hover:text-foreground hover:border-foreground/30 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors"
        >
          <Pencil className="size-3.5" strokeWidth={1.75} />
        </button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // Don't close when clicking the DatePicker popover.
          const target = e.target as HTMLElement | null;
          if (target?.closest('[data-radix-popper-content-wrapper]')) {
            e.preventDefault();
          }
        }}
        aria-describedby={undefined}
        className="gap-4 sm:p-6"
      >
        <DialogHeader className="gap-0">
          <DialogTitle className="text-xl">Edit extracted data</DialogTitle>
        </DialogHeader>

        <p className="border-foreground/12 bg-foreground/[0.04] text-foreground/75 rounded-xl border px-4 py-3 text-sm leading-relaxed">
          Changes here update this document only, edit the segment directly from the Itinerary tab
          if you also want the trip view to change.
        </p>

        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
          {draft.kind === 'boarding-pass' && (
            <BoardingPassFields
              value={draft}
              errors={fieldErrors}
              activeLegIndex={activeLegIndex}
              onActiveLegIndexChange={setActiveLegIndex}
              onChange={(patch) => setDraft({ ...draft, ...patch })}
            />
          )}
          {draft.kind === 'hotel-confirmation' && (
            <HotelFields
              value={draft}
              errors={fieldErrors}
              onChange={(patch) => setDraft({ ...draft, ...patch })}
            />
          )}
          {draft.kind === 'generic' && (
            <GenericFields
              value={draft}
              errors={fieldErrors}
              onChange={(patch) => setDraft({ ...draft, ...patch })}
            />
          )}

          {error && (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/8 text-destructive rounded-xl border px-4 py-3 text-sm"
            >
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Kind-specific field groups
// ---------------------------------------------------------------------------

// Helper: turn user input into the schema's expected null-for-missing.
// Whitespace-only inputs collapse to null so the schema's
// blankToNull preprocess + min(1) constraints don't reject a
// legitimately-cleared field as "too short".
function nullify(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

type BoardingPassPayload = Extract<StructuredPayload, { kind: 'boarding-pass' }>;
type FlightLeg = BoardingPassPayload['flights'][number];
type HotelPayload = Extract<StructuredPayload, { kind: 'hotel-confirmation' }>;
type GenericPayload = Extract<StructuredPayload, { kind: 'generic' }>;

// Edit any leg of a boarding-pass payload. Multi-leg docs render a
// tab strip above the field grid; the parent owns activeLegIndex so a
// submit-time validation failure can jump to the leg holding the
// offending field. Empty `flights[]` is rejected by the Zod schema,
// so the `?? EMPTY_LEG` fallback only ever runs in the
// impossible-state path; same for an out-of-range activeLegIndex (we
// pin it back to 0 here as a defence-in-depth measure rather than
// crashing the dialog).
const EMPTY_LEG: FlightLeg = {
  carrier: null,
  flightNumber: null,
  flightDate: null,
  scheduledDeparture: null,
  scheduledArrival: null,
  origin: null,
  destination: null,
  passengerName: null,
  confirmationCode: null,
};

function BoardingPassFields({
  value,
  errors,
  activeLegIndex,
  onActiveLegIndexChange,
  onChange,
}: {
  value: BoardingPassPayload;
  errors: Record<string, string>;
  activeLegIndex: number;
  onActiveLegIndexChange: (next: number) => void;
  // `Omit<…, 'kind'>` makes it a type error for a child to blast the
  // discriminator; we'd otherwise widen `draft.kind` and break the
  // discriminated-union narrowing in the parent.
  onChange: (patch: Partial<Omit<BoardingPassPayload, 'kind'>>) => void;
}) {
  const legCount = value.flights.length;
  const safeIndex = activeLegIndex >= 0 && activeLegIndex < legCount ? activeLegIndex : 0;
  const leg = value.flights[safeIndex] ?? EMPTY_LEG;
  const legPrefix = `flights.${safeIndex}.`;
  // The Zod paths land as e.g. `flights.0.carrier`. Look up errors by
  // the active leg's prefix so each tab sees only its own.
  const legErrors: Record<string, string> = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, msg] of Object.entries(errors)) {
      if (key.startsWith(legPrefix)) out[key.slice(legPrefix.length)] = msg;
    }
    return out;
  }, [errors, legPrefix]);

  function patchLeg(legPatch: Partial<FlightLeg>) {
    const next = value.flights.map((existing, i) =>
      i === safeIndex ? { ...existing, ...legPatch } : existing,
    );
    onChange({ flights: next });
  }

  return (
    <div className="flex flex-col gap-4">
      {legCount > 1 && (
        <LegTabs
          flights={value.flights}
          errors={errors}
          activeLegIndex={safeIndex}
          onChange={onActiveLegIndexChange}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Carrier" error={legErrors.carrier}>
          <Input
            placeholder="VN"
            value={leg.carrier ?? ''}
            onChange={(e) => patchLeg({ carrier: nullify(e.target.value)?.toUpperCase() ?? null })}
            maxLength={8}
            aria-invalid={!!legErrors.carrier || undefined}
          />
        </Field>
        <Field label="Flight number" error={legErrors.flightNumber}>
          <Input
            placeholder="32"
            value={leg.flightNumber ?? ''}
            onChange={(e) => patchLeg({ flightNumber: nullify(e.target.value) })}
            maxLength={8}
            aria-invalid={!!legErrors.flightNumber || undefined}
          />
        </Field>
        <Field label="Date" error={legErrors.flightDate}>
          <DatePicker
            value={leg.flightDate ?? ''}
            onChange={(next) => patchLeg({ flightDate: next === '' ? null : next })}
            invalid={!!legErrors.flightDate}
          />
        </Field>
        <Field label="Confirmation" error={legErrors.confirmationCode}>
          <Input
            placeholder="ABC123"
            value={leg.confirmationCode ?? ''}
            onChange={(e) => patchLeg({ confirmationCode: nullify(e.target.value) })}
            maxLength={20}
            aria-invalid={!!legErrors.confirmationCode || undefined}
          />
        </Field>
        <Field label="From" error={legErrors.origin}>
          <Input
            placeholder="MUC"
            value={leg.origin ?? ''}
            onChange={(e) => patchLeg({ origin: nullify(e.target.value)?.toUpperCase() ?? null })}
            maxLength={3}
            aria-invalid={!!legErrors.origin || undefined}
          />
        </Field>
        <Field label="To" error={legErrors.destination}>
          <Input
            placeholder="SGN"
            value={leg.destination ?? ''}
            onChange={(e) =>
              patchLeg({ destination: nullify(e.target.value)?.toUpperCase() ?? null })
            }
            maxLength={3}
            aria-invalid={!!legErrors.destination || undefined}
          />
        </Field>
        <Field label="Departure" error={legErrors.scheduledDeparture}>
          <DateTimeField
            value={leg.scheduledDeparture ?? ''}
            onChange={(next) => patchLeg({ scheduledDeparture: next === '' ? null : next })}
            withTime={true}
            invalid={!!legErrors.scheduledDeparture}
          />
        </Field>
        <Field label="Arrival" error={legErrors.scheduledArrival}>
          <DateTimeField
            value={leg.scheduledArrival ?? ''}
            onChange={(next) => patchLeg({ scheduledArrival: next === '' ? null : next })}
            withTime={true}
            invalid={!!legErrors.scheduledArrival}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Passenger" error={legErrors.passengerName}>
            <Input
              placeholder="Last, First"
              value={leg.passengerName ?? ''}
              onChange={(e) => patchLeg({ passengerName: nullify(e.target.value) })}
              maxLength={120}
              aria-invalid={!!legErrors.passengerName || undefined}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

// Build display labels for every leg, deduplicating route collisions
// (a return trip MUC→DXB→MUC would otherwise show two identical
// tabs). For legs missing one or both IATA codes we fall back to
// "Flight N" — that already has the ordinal baked in so it can't
// clash. Only the route-style labels need the disambiguator.
function labelsForLegs(flights: BoardingPassPayload['flights']): string[] {
  const base = flights.map((leg, i) =>
    leg.origin && leg.destination ? `${leg.origin}→${leg.destination}` : `Flight ${i + 1}`,
  );
  const counts = new Map<string, number>();
  for (const label of base) counts.set(label, (counts.get(label) ?? 0) + 1);
  return base.map((label, i) => ((counts.get(label) ?? 0) > 1 ? `${label} · ${i + 1}` : label));
}

// Whether any error key references this leg. Matches both
// `flights.${i}.<field>` (a per-field issue inside the leg) and the
// bare `flights.${i}` (a whole-leg refinement, theoretical today but
// cheap forward-compat).
function legHasError(errors: Record<string, string>, index: number): boolean {
  const exact = `flights.${index}`;
  const prefix = `flights.${index}.`;
  for (const key of Object.keys(errors)) {
    if (key === exact || key.startsWith(prefix)) return true;
  }
  return false;
}

// Plain button group with `aria-pressed`, not a `role="tablist"`. The
// strip looks tab-like but we deliberately avoid the WAI-ARIA tab
// contract: that pattern expects roving tabindex + ←/→/Home/End
// keybindings, and we don't implement those. `aria-pressed` is honest
// about what this actually is — a row of toggles — and Tab + Enter
// already work for keyboard users.
function LegTabs({
  flights,
  errors,
  activeLegIndex,
  onChange,
}: {
  flights: BoardingPassPayload['flights'];
  errors: Record<string, string>;
  activeLegIndex: number;
  onChange: (next: number) => void;
}) {
  const labels = React.useMemo(() => labelsForLegs(flights), [flights]);
  const erroredLegs = React.useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < flights.length; i++) {
      if (legHasError(errors, i)) set.add(i);
    }
    return set;
  }, [errors, flights.length]);

  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {flights.map((_, i) => {
        const active = i === activeLegIndex;
        const hasError = erroredLegs.has(i);
        return (
          <button
            key={i}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(i)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
              active
                ? 'border-foreground/30 bg-foreground/[0.06] text-foreground'
                : 'border-foreground/12 bg-foreground/[0.02] text-foreground/65 hover:bg-foreground/[0.04] hover:text-foreground',
            )}
          >
            <span>{labels[i]}</span>
            {hasError && (
              <span
                aria-label="has errors"
                className="bg-destructive inline-block size-1.5 rounded-full"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// Find the first leg referenced by any error path. Used on submit
// failure to switch the active tab to where the offending field
// lives. See {@link legHasError} for the path shapes recognised.
function firstLegWithError(fields: Record<string, string>, legCount: number): number | null {
  for (let i = 0; i < legCount; i++) {
    if (legHasError(fields, i)) return i;
  }
  return null;
}

function HotelFields({
  value,
  errors,
  onChange,
}: {
  value: HotelPayload;
  errors: Record<string, string>;
  onChange: (patch: Partial<Omit<HotelPayload, 'kind'>>) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Hotel" error={errors.hotelName}>
          <Input
            placeholder="Hotel California"
            value={value.hotelName ?? ''}
            onChange={(e) => onChange({ hotelName: nullify(e.target.value) })}
            maxLength={200}
            aria-invalid={!!errors.hotelName || undefined}
          />
        </Field>
      </div>
      <Field label="Check-in" error={errors.checkIn}>
        <DatePicker
          value={value.checkIn ?? ''}
          onChange={(next) => onChange({ checkIn: next === '' ? null : next })}
          invalid={!!errors.checkIn}
        />
      </Field>
      <Field label="Check-out" error={errors.checkOut}>
        <DatePicker
          value={value.checkOut ?? ''}
          onChange={(next) => onChange({ checkOut: next === '' ? null : next })}
          invalid={!!errors.checkOut}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Address" error={errors.address}>
          <Input
            placeholder="Street, City"
            value={value.address ?? ''}
            onChange={(e) => onChange({ address: nullify(e.target.value) })}
            maxLength={500}
            aria-invalid={!!errors.address || undefined}
          />
        </Field>
      </div>
      <Field label="Country" error={errors.country}>
        <Input
          placeholder="VN"
          value={value.country ?? ''}
          onChange={(e) => onChange({ country: nullify(e.target.value)?.toUpperCase() ?? null })}
          maxLength={2}
          aria-invalid={!!errors.country || undefined}
        />
      </Field>
      <Field label="Confirmation" error={errors.confirmationCode}>
        <Input
          placeholder="ABC123"
          value={value.confirmationCode ?? ''}
          onChange={(e) => onChange({ confirmationCode: nullify(e.target.value) })}
          maxLength={40}
          aria-invalid={!!errors.confirmationCode || undefined}
        />
      </Field>
    </div>
  );
}

function GenericFields({
  value,
  errors,
  onChange,
}: {
  value: GenericPayload;
  errors: Record<string, string>;
  onChange: (patch: Partial<Omit<GenericPayload, 'kind'>>) => void;
}) {
  return (
    <Field label="Summary" error={errors.summary}>
      <Textarea
        rows={4}
        value={value.summary}
        onChange={(e) => onChange({ summary: e.target.value })}
        maxLength={500}
        aria-invalid={!!errors.summary || undefined}
      />
    </Field>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
      {error && (
        <p role="alert" className="text-destructive text-xs leading-snug">
          {error}
        </p>
      )}
    </div>
  );
}
