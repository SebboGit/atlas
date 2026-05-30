'use client';

import { MapPin, Search } from 'lucide-react';
import * as React from 'react';
import { useWatch } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { searchPlaceCandidatesAction, type PlaceSearchResult } from '@/lib/geocoding/actions';
// Leaf import (not the geocoding barrel) so this client component never
// pulls the cache / pg driver into the browser bundle. Pure offline
// encode of the picked candidate's coordinates → a full Plus Code.
import { encodePlusCode } from '@/lib/geocoding/plus-code';
import type { GeocodeCandidate } from '@/lib/geocoding/types';
import { cn } from '@/lib/utils';

// react-hook-form's UseFormReturn is invariant over the discriminated-
// union FormInput, and nested-union field paths collapse under strict
// mode. We accept the form opaquely and route the four known paths
// through `as never` — the Zod resolver enforces the runtime shape at
// submit, same compromise the sibling PlusCode / country fields make.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = any;

// Length-11 Open Location Code ≈ sub-3 m precision. We capture the
// picked candidate's exact point so the map pin lands on it via the
// offline-decode path — no second geocode, no rounding drift from the
// default 10-char (~14 m) code.
const PICK_CODE_LENGTH = 11;

// Which `data.<field>` holds the venue / POI NAME for each geocoded
// type. This — never the typed address — is what we search on (the
// locked design: hand-typed addresses fail across much of Asia /
// informal areas).
type PickerType = 'hotel' | 'activity' | 'transit' | 'food';
const NAME_FIELD: Record<PickerType, string> = {
  hotel: 'data.propertyName',
  activity: 'data.title',
  transit: 'data.toName',
  food: 'data.venue',
};

interface PlaceFinderProps {
  form: AnyForm;
  type: PickerType;
}

type Phase =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'results'; candidates: GeocodeCandidate[] }
  | { status: 'empty' }
  // Permanent server-config state (NOMINATIM_CONTACT_EMAIL unset). No
  // retry — it can never succeed; the copy points at manual entry.
  | { status: 'unavailable' }
  | { status: 'error' };

/**
 * "Find location" button + candidate picker dialog. ONE Nominatim
 * search per click (the OSM usage policy forbids as-you-type). Searches
 * the venue NAME (+ locationName + country), shows up to 3 candidates,
 * and on pick fills `data.address` + `data.plusCode` (and the country
 * dropdown only if empty) so the map pin is precise with no second
 * geocode.
 *
 * Place it directly below the address Input in each geocoded type's
 * field module.
 */
export function PlaceFinder({ form, type }: PlaceFinderProps) {
  const [open, setOpen] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>({ status: 'idle' });
  const [pending, startTransition] = React.useTransition();

  const nameValue = useWatch({
    control: form.control,
    name: NAME_FIELD[type] as never,
  }) as unknown;
  const name = typeof nameValue === 'string' ? nameValue.trim() : '';
  const hasName = name !== '';
  const isDisabled = !hasName || pending;
  const hintId = `place-finder-hint-${type}`;

  function runSearch() {
    setOpen(true);
    setPhase({ status: 'loading' });

    const locationNameRaw = form.getValues('locationName' as never) as unknown;
    const countryRaw = form.getValues('countryCode' as never) as unknown;
    const locationName =
      typeof locationNameRaw === 'string' && locationNameRaw.trim() !== ''
        ? locationNameRaw.trim()
        : undefined;
    const countryCode =
      typeof countryRaw === 'string' && countryRaw.trim() !== '' ? countryRaw.trim() : undefined;

    startTransition(async () => {
      const result: PlaceSearchResult = await searchPlaceCandidatesAction({
        type,
        name,
        ...(locationName ? { locationName } : {}),
        ...(countryCode ? { countryCode } : {}),
      });

      if (!result.ok) {
        // `unconfigured` is permanent (missing env) — a retry can never
        // succeed, so route it to a no-retry state. `invalid` (rejected
        // input) keeps the retry path.
        setPhase({ status: result.reason === 'unconfigured' ? 'unavailable' : 'error' });
        return;
      }
      if (result.candidates.length === 0) {
        setPhase({ status: 'empty' });
        return;
      }
      setPhase({ status: 'results', candidates: result.candidates });
    });
  }

  function pick(candidate: GeocodeCandidate) {
    // Address: the candidate's full display string. This is the OUTPUT
    // the user chose — display-only once a Plus Code is set, since the
    // Plus Code wins precedence in buildGeocodeQuery. Clamped to the
    // schema's 500-char cap so a very long display_name (deep multi-line
    // Asian addresses) can't flag a spurious "too long" error; the pin
    // is unaffected (it rides the Plus Code).
    const address = candidate.addressLabel.slice(0, 500);
    form.setValue('data.address' as never, address as never, {
      shouldDirty: true,
      shouldValidate: true,
    });

    // Plus Code: encode the exact picked point at sub-3 m precision so
    // the pin lands on it offline. If encode somehow fails (non-finite
    // coords — shouldn't happen, the searcher validates), we still set
    // the address; the segment just falls back to address geocoding.
    const code = encodePlusCode(candidate.lat, candidate.lng, PICK_CODE_LENGTH);
    if (code) {
      form.setValue('data.plusCode' as never, code as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }

    // Country: fill ONLY if empty — never overwrite a country the user
    // set. Mirrors the flight IATA→country autofill rule.
    if (candidate.countryCode) {
      const current = form.getValues('countryCode' as never) as unknown;
      const isEmpty = current === '' || current === null || current === undefined;
      if (isEmpty) {
        form.setValue('countryCode' as never, candidate.countryCode as never, {
          shouldDirty: true,
          shouldValidate: false,
        });
      }
    }

    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={runSearch}
        disabled={isDisabled}
        // Self-start keeps the button compact on laptop; min-h-11 on
        // touch devices meets the 44px target. The native `disabled`
        // already exposes the state to AT — no redundant aria-disabled;
        // the reason is wired via aria-describedby to the visible hint.
        className="-mt-1 self-start [@media(hover:none)]:min-h-11"
        aria-describedby={!hasName ? hintId : undefined}
      >
        <Search aria-hidden />
        Find location
      </Button>
      {!hasName && (
        <p id={hintId} className="text-muted-foreground -mt-1 text-xs leading-snug">
          Add a name to search for this place.
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          // Cap the candidate panel; the list scrolls inside if all
          // three rows + chrome exceed the sheet height on a short
          // phone. overflow-x stays locked by DialogContent itself.
          // No aria-describedby override — the DialogDescription below
          // auto-associates so screen readers announce the guidance.
          className="sm:max-w-[30rem]"
        >
          <DialogHeader>
            <DialogTitle>Find location</DialogTitle>
            <DialogDescription>Pick the match to pin it precisely on the map.</DialogDescription>
          </DialogHeader>
          <PickerBody phase={phase} onPick={pick} onRetry={runSearch} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function PickerBody({
  phase,
  onPick,
  onRetry,
}: {
  phase: Phase;
  onPick: (c: GeocodeCandidate) => void;
  onRetry: () => void;
}) {
  if (phase.status === 'loading') {
    return (
      <p
        className="text-muted-foreground py-6 text-center text-sm"
        role="status"
        aria-live="polite"
      >
        Searching…
      </p>
    );
  }

  if (phase.status === 'error') {
    return (
      <div className="flex flex-col gap-3 py-2" role="alert">
        <p className="text-muted-foreground text-sm leading-relaxed">
          Couldn&apos;t run the search. You can still enter the address or Plus Code by hand.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="self-start">
          Try again
        </Button>
      </div>
    );
  }

  if (phase.status === 'unavailable') {
    return (
      <p
        className="text-muted-foreground py-2 text-sm leading-relaxed"
        role="status"
        aria-live="polite"
      >
        Search isn&apos;t available. Enter the address or Plus Code by hand.
      </p>
    );
  }

  if (phase.status === 'empty') {
    return (
      <div className="flex flex-col gap-3 py-2" role="status" aria-live="polite">
        <p className="text-muted-foreground text-sm leading-relaxed">
          No matches. Try a broader name, or set the country and search again.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="self-start">
          Try again
        </Button>
      </div>
    );
  }

  if (phase.status === 'results') {
    return (
      <ul className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto pr-1" aria-label="Matches">
        {phase.candidates.map((candidate, i) => (
          <li key={`${candidate.lat},${candidate.lng},${i}`}>
            <CandidateRow candidate={candidate} onPick={() => onPick(candidate)} />
          </li>
        ))}
      </ul>
    );
  }

  return null;
}

function CandidateRow({ candidate, onPick }: { candidate: GeocodeCandidate; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        // Full-width, ≥44px touch target, left-aligned multi-line.
        'border-foreground/12 bg-card/60 hover:bg-card hover:border-foreground/25',
        'focus-visible:ring-primary/40 focus-visible:ring-offset-background flex w-full',
        'min-h-11 flex-col gap-1 rounded-xl border px-4 py-3 text-left transition-colors',
        'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
      )}
    >
      <span className="flex items-start gap-2">
        <MapPin aria-hidden className="text-primary mt-0.5 size-4 shrink-0" />
        <span className="text-foreground text-sm leading-snug font-medium">{candidate.name}</span>
      </span>
      <span className="text-muted-foreground pl-6 text-xs leading-snug break-words">
        {candidate.addressLabel}
      </span>
      {candidate.osmType && (
        <span className="pl-6">
          <span className="border-foreground/12 text-foreground/70 inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase">
            {candidate.osmType}
          </span>
        </span>
      )}
    </button>
  );
}
