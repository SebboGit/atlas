'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { CountrySelect } from '@/components/ui/country-select';
import { DateTimeField } from '@/components/ui/date-time-field';
import {
  DialogScrollableBody,
  DialogStickyFooter,
  dialogScrollContainer,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAirportCountry, getAirportTimezone } from '@/lib/airports';
import { flightDataSchema, type Segment } from '@/lib/segments';
import { updateFlightLegsAction } from '@/lib/segments/actions';
import { cn } from '@/lib/utils';

import { fromDateTimeValue, toDateTimeValue } from './segment-form-fields/shared-date-fields';

// One draft per sibling flight segment. The form keeps these
// independent — switching tabs swaps which draft renders; a single
// Save persists every dirty leg via {@link updateFlightLegsAction}
// inside a DB transaction.
//
// String-flavoured fields back native `<Input>` controls cleanly: a
// null in the row becomes '' in the draft and round-trips to null on
// submit when blank. `startsAt` / `endsAt` are either a Date (segment
// row), a 'yyyy-mm-dd[Thh:mm]' string the user just edited, or null
// for cleared. The Zod `dateInput` accepts all three.
interface DraftLeg {
  id: string;
  carrier: string;
  flightNumber: string;
  originAirport: string;
  destinationAirport: string;
  pnr: string;
  seat: string;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  countryCode: string;
  originCountryCode: string;
}

interface MultiLegFlightFormProps {
  tripId: string;
  segments: Segment[];
  initialActiveSegmentId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

// Empty string is the "unset" sentinel for the string-flavoured
// fields — null on the row turns into '' here. Going the other way,
// blank trims to null before submission so the validator's optional
// fields work as designed.
function blank(s: string | null | undefined): string {
  return s ?? '';
}

function nullify(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

function segmentToDraft(s: Segment): DraftLeg {
  // The JSONB `data` payload is parsed defensively — a malformed
  // payload becomes an all-blank draft rather than throwing. The
  // segment row's columns (startsAt / endsAt / country codes) are
  // typed and authoritative; we read them directly.
  const parsed = flightDataSchema.safeParse(s.data);
  const data = parsed.success ? parsed.data : {};
  return {
    id: s.id,
    carrier: blank(data.carrier),
    flightNumber: blank(data.flightNumber),
    originAirport: blank(data.originAirport),
    destinationAirport: blank(data.destinationAirport),
    pnr: blank(data.pnr),
    seat: blank(data.seat),
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    countryCode: blank(s.countryCode),
    originCountryCode: blank(s.originCountryCode),
  };
}

// Map a draft back to the discriminated `segmentCreateInput` shape.
// The validator on the server side does the heavy lifting (trim,
// uppercase, length checks); this just strips empty strings so its
// `.optional()` fields can remain unset, and routes the dates as-is
// since `dateInput` accepts Date | string | null.
function draftToInput(draft: DraftLeg): unknown {
  return {
    type: 'flight',
    data: {
      carrier: nullify(draft.carrier) ?? undefined,
      flightNumber: nullify(draft.flightNumber) ?? undefined,
      originAirport: nullify(draft.originAirport) ?? undefined,
      destinationAirport: nullify(draft.destinationAirport) ?? undefined,
      pnr: nullify(draft.pnr) ?? undefined,
      seat: nullify(draft.seat) ?? undefined,
    },
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    locationName: null,
    countryCode: draft.countryCode === '' ? null : draft.countryCode,
    originCountryCode: draft.originCountryCode === '' ? null : draft.originCountryCode,
  };
}

// Build display labels for every leg, deduplicating route collisions
// (a MUC→DXB→MUC return trip would otherwise show two identical
// tabs). For legs missing one or both IATA codes we fall back to
// "Flight N" — that ordinal can't collide with route-style labels.
// Mirrors the same helper in `parsed-edit-dialog.tsx`.
function labelsForLegs(legs: ReadonlyArray<DraftLeg>): string[] {
  const base = legs.map((leg, i) =>
    leg.originAirport && leg.destinationAirport
      ? `${leg.originAirport}→${leg.destinationAirport}`
      : `Flight ${i + 1}`,
  );
  const counts = new Map<string, number>();
  for (const label of base) counts.set(label, (counts.get(label) ?? 0) + 1);
  return base.map((label, i) => ((counts.get(label) ?? 0) > 1 ? `${label} · ${i + 1}` : label));
}

// Strip the `legs.${i}.input.` / `legs.${i}.` prefix from server
// field-error keys so the active leg's field components see paths
// they understand: `data.originAirport`, `startsAt`, `countryCode`,
// etc. The server emits both shapes — `flightLegsUpdateInput.legs`
// has `{ id, input }` per leg, so `input.startsAt` and `input.data.X`
// are the path tails we need to surface; the bare `legs.${i}.id`
// case is theoretical (we never expose `id` editing) but cheap to
// handle.
function legErrorsAt(fields: Record<string, string>, index: number): Record<string, string> {
  const out: Record<string, string> = {};
  const innerPrefix = `legs.${index}.input.`;
  const legPrefix = `legs.${index}.`;
  for (const [key, msg] of Object.entries(fields)) {
    if (key.startsWith(innerPrefix)) out[key.slice(innerPrefix.length)] = msg;
    else if (key.startsWith(legPrefix)) out[key.slice(legPrefix.length)] = msg;
  }
  return out;
}

function legHasError(fields: Record<string, string>, index: number): boolean {
  const innerPrefix = `legs.${index}.input.`;
  const legPrefix = `legs.${index}.`;
  for (const key of Object.keys(fields)) {
    if (key.startsWith(innerPrefix) || key.startsWith(legPrefix)) return true;
  }
  return false;
}

// Lowest-index leg referenced by any error path. Reads from the
// already-computed errored-legs set so the caller doesn't re-scan
// the fields map; we sort the set's iterator to be explicit (Set
// iteration order is insertion order, which matches construction
// order from a `for i in 0..n` loop, but relying on that is
// fragile).
function firstErroredLeg(erroredLegs: ReadonlySet<number>): number | null {
  if (erroredLegs.size === 0) return null;
  return Math.min(...erroredLegs);
}

export function MultiLegFlightForm({
  tripId,
  segments,
  initialActiveSegmentId,
  onSuccess,
  onCancel,
}: MultiLegFlightFormProps) {
  // Drafts persist across tab switches because they live in state,
  // not in the DOM — the inactive tabs unmount their inputs but the
  // draft for that leg is still here.
  const [drafts, setDrafts] = React.useState<DraftLeg[]>(() => segments.map(segmentToDraft));
  const initialIndex = React.useMemo(() => {
    const found = segments.findIndex((s) => s.id === initialActiveSegmentId);
    return found >= 0 ? found : 0;
  }, [segments, initialActiveSegmentId]);
  const [activeLegIndex, setActiveLegIndex] = React.useState(initialIndex);
  const [pending, startTransition] = React.useTransition();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const safeIndex = activeLegIndex >= 0 && activeLegIndex < drafts.length ? activeLegIndex : 0;
  const activeDraft = drafts[safeIndex];
  const labels = React.useMemo(() => labelsForLegs(drafts), [drafts]);
  const activeLegErrors = React.useMemo(
    () => legErrorsAt(fieldErrors, safeIndex),
    [fieldErrors, safeIndex],
  );
  const erroredLegs = React.useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < drafts.length; i++) {
      if (legHasError(fieldErrors, i)) set.add(i);
    }
    return set;
  }, [fieldErrors, drafts.length]);

  function patchActive(patch: Partial<DraftLeg>) {
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== safeIndex) return d;
        const merged: DraftLeg = { ...d, ...patch };
        // IATA is canonical for country: when the airport changes to
        // one we recognise, follow it. Mirrors `useAirportCountryAutofill`
        // in the single-segment form. Partial/unknown IATAs leave the
        // country untouched so we don't blank it out mid-keystroke.
        if ('originAirport' in patch) {
          const next = getAirportCountry(merged.originAirport);
          if (next) merged.originCountryCode = next;
        }
        if ('destinationAirport' in patch) {
          const next = getAirportCountry(merged.destinationAirport);
          if (next) merged.countryCode = next;
        }
        return merged;
      }),
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});
    startTransition(async () => {
      const payload = {
        legs: drafts.map((d) => ({ id: d.id, input: draftToInput(d) })),
      };
      const result = await updateFlightLegsAction(tripId, payload);
      if (!result.ok) {
        const fields = result.error.fields ?? {};
        setFieldErrors(fields);
        // Per-leg errors light up the tab dots; we additionally
        // surface a bare-`legs` error (validator min/max, etc.) in
        // the form banner because no tab matches it. Without this,
        // the generic "Please fix the highlighted fields" banner
        // appears while nothing is actually highlighted.
        setFormError(fields.legs ?? result.error.formMessage ?? 'Could not save changes.');
        // Compute the errored-leg set once and reuse for the jump —
        // matches the `useMemo` the tab strip reads from.
        const errored = new Set<number>();
        for (let i = 0; i < drafts.length; i++) {
          if (legHasError(fields, i)) errored.add(i);
        }
        const target = firstErroredLeg(errored);
        if (target !== null) setActiveLegIndex(target);
        return;
      }
      onSuccess();
    });
  }

  if (!activeDraft) {
    // Defence-in-depth — the parent guarantees `segments.length >=
    // 1`, so this only fires under programming error. Show the
    // banner rather than crashing the dialog.
    return (
      <div
        role="alert"
        className="border-destructive/30 bg-destructive/8 text-destructive rounded-xl border px-4 py-3 text-sm"
      >
        No flight legs to edit.
      </div>
    );
  }

  // Wall-clock timezone for the active leg's DateTimeField inputs.
  // Mirrors `SharedDateFields` so the displayed times match the
  // airport's local clock when the IATA is known. Null falls back
  // to the user's runtime timezone — same convention as elsewhere.
  const startTz = getAirportTimezone(activeDraft.originAirport || null);
  const endTz = getAirportTimezone(activeDraft.destinationAirport || null);

  return (
    <form noValidate onSubmit={onSubmit} className={dialogScrollContainer}>
      <DialogScrollableBody>
        <LegTabs
          legs={drafts}
          labels={labels}
          activeLegIndex={safeIndex}
          erroredLegs={erroredLegs}
          onChange={setActiveLegIndex}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          {/*
          Row order mirrors `FlightFields` in the single-segment form:
          From/To first so the route reads left-to-right at the top,
          then Carrier/Flight no., then Departure/Arrival.
        */}
          <FieldRow label="From (IATA)" error={activeLegErrors['data.originAirport']}>
            <Input
              placeholder="LHR"
              maxLength={3}
              value={activeDraft.originAirport}
              onChange={(e) => patchActive({ originAirport: e.target.value.toUpperCase() })}
              aria-invalid={!!activeLegErrors['data.originAirport'] || undefined}
            />
          </FieldRow>
          <FieldRow label="To (IATA)" error={activeLegErrors['data.destinationAirport']}>
            <Input
              placeholder="HND"
              maxLength={3}
              value={activeDraft.destinationAirport}
              onChange={(e) => patchActive({ destinationAirport: e.target.value.toUpperCase() })}
              aria-invalid={!!activeLegErrors['data.destinationAirport'] || undefined}
            />
          </FieldRow>

          <FieldRow label="Carrier" optional error={activeLegErrors['data.carrier']}>
            <Input
              placeholder="British Airways"
              value={activeDraft.carrier}
              onChange={(e) => patchActive({ carrier: e.target.value })}
              aria-invalid={!!activeLegErrors['data.carrier'] || undefined}
            />
          </FieldRow>
          <FieldRow label="Flight no." optional error={activeLegErrors['data.flightNumber']}>
            <Input
              placeholder="BA 5"
              value={activeDraft.flightNumber}
              onChange={(e) => patchActive({ flightNumber: e.target.value })}
              aria-invalid={!!activeLegErrors['data.flightNumber'] || undefined}
            />
          </FieldRow>

          <FieldRow label="Departure" error={activeLegErrors.startsAt}>
            <DateTimeField
              value={toDateTimeValue(activeDraft.startsAt, startTz)}
              onChange={(s) => patchActive({ startsAt: fromDateTimeValue(s, startTz) })}
              withTime
              invalid={!!activeLegErrors.startsAt}
            />
          </FieldRow>
          <FieldRow label="Arrival" optional error={activeLegErrors.endsAt}>
            <DateTimeField
              value={toDateTimeValue(activeDraft.endsAt, endTz)}
              onChange={(s) => patchActive({ endsAt: fromDateTimeValue(s, endTz) })}
              withTime
              invalid={!!activeLegErrors.endsAt}
            />
          </FieldRow>

          <FieldRow label="Origin country" optional error={activeLegErrors.originCountryCode}>
            <CountrySelect
              value={activeDraft.originCountryCode}
              onChange={(v) => patchActive({ originCountryCode: v })}
              invalid={!!activeLegErrors.originCountryCode}
            />
          </FieldRow>
          <FieldRow label="Destination country" optional error={activeLegErrors.countryCode}>
            <CountrySelect
              value={activeDraft.countryCode}
              onChange={(v) => patchActive({ countryCode: v })}
              invalid={!!activeLegErrors.countryCode}
            />
          </FieldRow>

          <div className="sm:col-span-2">
            <FieldRow label="PNR" optional error={activeLegErrors['data.pnr']}>
              <Input
                placeholder="ABC123"
                value={activeDraft.pnr}
                onChange={(e) => patchActive({ pnr: e.target.value })}
                aria-invalid={!!activeLegErrors['data.pnr'] || undefined}
              />
            </FieldRow>
          </div>
        </div>

        {formError && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/8 text-destructive rounded-xl border px-4 py-3 text-sm"
          >
            {formError}
          </div>
        )}
      </DialogScrollableBody>

      <DialogStickyFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </DialogStickyFooter>
    </form>
  );
}

// Plain button group with `aria-pressed` — same honest pattern as the
// parsed-edit-dialog tab strip. We deliberately don't claim
// `role="tablist"` because we don't implement the WAI-ARIA roving
// tabindex + arrow keys contract; Tab + Enter already work.
function LegTabs({
  legs,
  labels,
  activeLegIndex,
  erroredLegs,
  onChange,
}: {
  legs: ReadonlyArray<{ id: string }>;
  labels: string[];
  activeLegIndex: number;
  erroredLegs: Set<number>;
  onChange: (next: number) => void;
}) {
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {labels.map((label, i) => {
        const active = i === activeLegIndex;
        const hasError = erroredLegs.has(i);
        return (
          <button
            // Keyed by leg id (not index) so a future "reorder legs"
            // path wouldn't bleed draft state across tabs. Today
            // `drafts` is fixed-length and stable, so this is purely
            // defensive.
            key={legs[i]?.id ?? i}
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
            <span>{label}</span>
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

function FieldRow({
  label,
  optional,
  error,
  children,
}: {
  label: string;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>
        {label}
        {optional && (
          <span className="text-foreground/40 tracking-normal normal-case"> · optional</span>
        )}
      </Label>
      {children}
      {error && (
        <p role="alert" className="text-destructive text-xs leading-snug">
          {error}
        </p>
      )}
    </div>
  );
}
