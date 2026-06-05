'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { BedDouble, Plane, Sparkles, StickyNote, UtensilsCrossed, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  DialogScrollableBody,
  DialogStickyFooter,
  dialogScrollContainer,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { SEGMENT_TYPES, segmentCreateInput, type SegmentType } from '@/lib/segments';
import type { FormError } from '@/lib/segments/actions';
import { cn } from '@/lib/utils';
import type { Result } from '@/types/result';

import { ActivityFields } from './segment-form-fields/activity-fields';
import { CountryFields } from './segment-form-fields/country-fields';
import { FlightFields } from './segment-form-fields/flight-fields';
import { FoodFields } from './segment-form-fields/food-fields';
import { FormBanner, type FormInput, type FormOutput } from './segment-form-fields/_helpers';
import { HotelFields } from './segment-form-fields/hotel-fields';
import { NoteFields } from './segment-form-fields/note-fields';
import { NoteDateField, SharedDateFields } from './segment-form-fields/shared-date-fields';
import { TransitFields } from './segment-form-fields/transit-fields';

const TYPE_LABELS: Record<SegmentType, string> = {
  flight: 'Flight',
  hotel: 'Hotel',
  activity: 'Activity',
  transit: 'Transit',
  food: 'Food',
  note: 'Note',
};

// The same lucide glyphs the cards use, so the picker reads as a preview
// of what each segment will look like. Transit takes the generic
// Waypoints mark (the card swaps in a mode-specific icon once a mode is
// picked); the rest match their card variant one-for-one.
const TYPE_GLYPH: Record<SegmentType, LucideIcon> = {
  flight: Plane,
  hotel: BedDouble,
  activity: Sparkles,
  transit: Waypoints,
  food: UtensilsCrossed,
  note: StickyNote,
};

interface SegmentFormProps {
  // When set, the type picker is hidden and that type is enforced
  // (used by tab-scoped "Add flight"/"Add hotel" buttons, and by the
  // edit mode of SegmentFormDialog where changing type post-creation
  // is forbidden).
  defaultType?: SegmentType;
  // Prefill values for edit mode. When set, the form opens populated
  // with the existing segment's data and the type picker is locked
  // (independently of `defaultType` so the call site doesn't have to
  // pass both). Server-side updateSegmentAction additionally rejects
  // a type mismatch as defence in depth.
  initialValues?: FormInput;
  onSubmit: (input: FormOutput) => Promise<Result<{ id: string }, FormError>>;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

// Initial values for the per-type `data` subtree. Reset to this when
// the user switches segment type so stale fields don't leak past
// validation.
function emptyDataFor(type: SegmentType): FormInput['data'] {
  switch (type) {
    case 'flight':
      return {} as FormInput['data'];
    case 'hotel':
      return { propertyName: '' } as FormInput['data'];
    case 'activity':
      return { title: '' } as FormInput['data'];
    case 'transit':
      return { mode: 'train' } as FormInput['data'];
    case 'food':
      return { venue: '' } as FormInput['data'];
    case 'note':
      return { body: '' } as FormInput['data'];
  }
}

export function SegmentForm({
  defaultType,
  initialValues,
  onSubmit,
  onSuccess,
  onCancel,
  submitLabel,
}: SegmentFormProps) {
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Edit mode (initialValues set) locks the type — changing it after
  // creation is forbidden by the server action. Otherwise, a
  // `defaultType` from a tab-scoped "Add X" button locks it.
  const initialType: SegmentType = initialValues?.type ?? defaultType ?? 'activity';
  const typeLocked = !!initialValues || !!defaultType;

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(segmentCreateInput),
    // Cast: the discriminated-union FormInput narrows `data` based on
    // `type`. RHF's defaultValues type expects an exact variant, but
    // we set type + data together so the shape is correct at runtime.
    defaultValues:
      initialValues ??
      ({
        type: initialType,
        data: emptyDataFor(initialType),
        startsAt: '',
        endsAt: '',
        locationName: '',
        countryCode: '',
        originCountryCode: '',
      } as FormInput),
  });

  const { handleSubmit, setError, setValue, control } = form;

  const currentType = useWatch({ control, name: 'type' }) as SegmentType;

  // Reset `data` whenever the discriminator changes. Without this, a
  // hidden carry-over (e.g. propertyName from a previous hotel pick)
  // would fail the new branch's strict-data validation.
  //
  // Country / location are *not* cleared on switch — the validator
  // strips them per-variant (validators.ts), so they can survive a
  // round-trip through note and reappear if the user changes their
  // mind back to flight.
  const prevTypeRef = React.useRef(initialType);
  React.useEffect(() => {
    if (prevTypeRef.current === currentType) return;
    prevTypeRef.current = currentType;
    setValue('data', emptyDataFor(currentType), {
      shouldDirty: false,
      shouldValidate: false,
    });
  }, [currentType, setValue]);

  // WAI-ARIA radio-group keyboard model for the type chips: the group is a
  // single tab stop (roving tabindex), and Arrow/Home/End move *and* select
  // within it — the roles promise this, so it has to actually work.
  const chipRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onTypeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const handled = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!handled.includes(e.key)) return;
    e.preventDefault();
    const n = SEGMENT_TYPES.length;
    const idx = SEGMENT_TYPES.indexOf(currentType);
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % n;
    else next = (idx - 1 + n) % n;
    setValue('type', SEGMENT_TYPES[next]!, { shouldDirty: true, shouldValidate: true });
    chipRefs.current[next]?.focus();
  };

  function applyServerErrors(error: FormError) {
    setFormError(error.formMessage ?? null);
    if (!error.fields) return;
    for (const [name, message] of Object.entries(error.fields)) {
      setError(name as keyof FormInput, { type: 'server', message });
    }
  }

  function submit(values: FormOutput) {
    setFormError(null);
    startTransition(async () => {
      const result = await onSubmit(values);
      if (result.ok) onSuccess?.(result.value.id);
      else applyServerErrors(result.error);
    });
  }

  return (
    <form noValidate onSubmit={handleSubmit(submit)} className={dialogScrollContainer}>
      <DialogScrollableBody>
        {!typeLocked && (
          <div className="flex flex-col gap-2">
            <Label id="seg-type-label">Type</Label>
            {/* One-tap chip row replacing the native <Select> — no
             *  dropdown round-trip on the highest-traffic add action.
             *  Radiogroup semantics keep it keyboard- and
             *  screen-reader-accessible; selection writes the same
             *  `type` field the resolver reads, so the per-type data
             *  reset (see the effect above) still fires on switch. */}
            <div
              role="radiogroup"
              aria-labelledby="seg-type-label"
              onKeyDown={onTypeKeyDown}
              // Fixed grid, not flex-wrap: the six types lay out 2-up on a
              // phone and 3-up from sm: — even rows, no lone chip dangling
              // on a second line. And no negative margin: the old `-mx-0.5`
              // pulled the leftmost chip's border under DialogScrollableBody's
              // `overflow-x-hidden` clip edge, shaving it off on each row.
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {SEGMENT_TYPES.map((t, i) => {
                const Glyph = TYPE_GLYPH[t];
                const selected = currentType === t;
                return (
                  <button
                    key={t}
                    ref={(el) => {
                      chipRefs.current[i] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setValue('type', t, { shouldDirty: true, shouldValidate: true })}
                    className={cn(
                      // ≥44px touch target via min-height; each chip
                      // stretches to fill its grid cell.
                      'inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium tracking-tight transition-[background-color,border-color,color] duration-150',
                      'focus-visible:ring-primary/40 focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                      '[&_svg]:size-4 [&_svg]:shrink-0',
                      selected
                        ? 'border-primary/55 bg-primary/8 text-primary'
                        : 'border-foreground/15 bg-card/60 text-foreground/70 hover:border-foreground/30 hover:text-foreground',
                    )}
                  >
                    <Glyph
                      strokeWidth={1.5}
                      className={selected ? 'text-primary' : 'text-foreground/55'}
                    />
                    {TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {currentType === 'flight' && <FlightFields form={form} />}
        {currentType === 'hotel' && <HotelFields form={form} />}
        {currentType === 'activity' && <ActivityFields form={form} />}
        {currentType === 'transit' && <TransitFields form={form} />}
        {currentType === 'food' && <FoodFields form={form} />}
        {currentType === 'note' && <NoteFields form={form} />}

        {currentType !== 'note' && <SharedDateFields form={form} type={currentType} />}
        {currentType === 'note' && <NoteDateField form={form} />}

        <CountryFields form={form} type={currentType} />

        {formError && <FormBanner>{formError}</FormBanner>}
      </DialogScrollableBody>

      <DialogStickyFooter>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : (submitLabel ?? `Add ${TYPE_LABELS[currentType].toLowerCase()}`)}
        </Button>
      </DialogStickyFooter>
    </form>
  );
}
