'use client';

import { useWatch } from 'react-hook-form';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// Leaf import (not the barrel) so this client component doesn't pull
// the geocoding cache / pg driver into the browser bundle.
import { tryParsePlusCode } from '@/lib/geocoding/plus-code';

import { FieldError, Optional } from './_helpers';

// react-hook-form's `UseFormReturn<T>` is invariant over `T`, and the
// strict-mode discriminated-union path types collapse on nested unions.
// We accept the form opaquely and route field paths through `as never`
// — the Zod resolver enforces the runtime shape at submit time, so the
// lost compile-time precision on these two known paths is acceptable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = any;

interface PlusCodeFieldsProps {
  form: AnyForm;
  /**
   * Per-type ID prefix to keep input IDs unique on the page (the food
   * form already uses `seg-food-*`, the others use `seg-*` — we follow
   * that convention rather than inventing a new one).
   */
  idPrefix?: string;
}

type DataErrors = Record<string, { message?: string } | undefined>;
function dataErrorsOf(errors: unknown): DataErrors {
  if (errors === null || typeof errors !== 'object') return {};
  return ((errors as { data?: DataErrors }).data ?? {}) as DataErrors;
}

/**
 * Shared Plus Code input. Drops below the per-type address Input.
 * The companion "paste into address" nudge is {@link PlusCodeNudge} —
 * place it directly below the address input (NOT here) so the user
 * sees it the moment they paste a Plus Code into the wrong field.
 */
export function PlusCodeFields({ form, idPrefix = 'seg' }: PlusCodeFieldsProps) {
  const e = dataErrorsOf(form.formState.errors);
  const id = `${idPrefix}-plus-code`;
  const plusCodeValue = useWatch({
    control: form.control,
    name: 'data.plusCode' as never,
  }) as unknown;
  const plusCodeStr = typeof plusCodeValue === 'string' ? plusCodeValue : undefined;

  // Live status hint shown beneath the input — distinct from the
  // schema-side error (which only fires on blur/submit).
  const hint = describeHint(plusCodeStr);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <Label htmlFor={id}>
          Plus Code <Optional />
        </Label>
        <span className="text-muted-foreground/80 text-xs">From a Google Maps place card</span>
      </div>
      <Input
        id={id}
        placeholder="8Q7XMPWG+5V"
        className="font-mono"
        autoCapitalize="characters"
        spellCheck={false}
        aria-invalid={!!e.plusCode || undefined}
        {...form.register('data.plusCode' as never)}
      />
      {e.plusCode?.message && <FieldError>{e.plusCode.message}</FieldError>}
      {hint && !e.plusCode?.message && (
        <p className="text-muted-foreground text-xs leading-snug">{hint}</p>
      )}
    </div>
  );
}

/**
 * Tiny inline link that appears directly below the address input when
 * the user has pasted a Plus Code-shaped string into it. One click
 * moves the value across to `data.plusCode` and clears `data.address`.
 *
 * Lives next to the address field (not next to the Plus Code field)
 * because that's where the eye lands the moment the wrong-field paste
 * happens — surfacing it under the Plus Code field would miss the
 * teachable moment.
 */
export function PlusCodeNudge({ form }: { form: AnyForm }) {
  const addressValue = useWatch({
    control: form.control,
    name: 'data.address' as never,
  }) as unknown;
  const plusCodeValue = useWatch({
    control: form.control,
    name: 'data.plusCode' as never,
  }) as unknown;
  const addressStr = typeof addressValue === 'string' ? addressValue : undefined;
  const plusCodeStr = typeof plusCodeValue === 'string' ? plusCodeValue : undefined;

  const addressLooksLikePlusCode =
    addressStr !== undefined &&
    addressStr.trim() !== '' &&
    tryParsePlusCode(addressStr) !== null &&
    (plusCodeStr === undefined || plusCodeStr.trim() === '');

  if (!addressLooksLikePlusCode) return null;

  function move() {
    if (!addressStr) return;
    form.setValue('data.plusCode' as never, addressStr.trim() as never, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue('data.address' as never, '' as never, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  return (
    <button
      type="button"
      onClick={move}
      className="text-primary hover:text-primary/80 -mt-1 self-start text-xs font-medium underline-offset-2 hover:underline"
    >
      Looks like a Plus Code — move it to the Plus Code field
    </button>
  );
}

/**
 * Inline hint reflecting what the user has typed so far. Distinct from
 * the schema error — this guides them mid-typing without surfacing a
 * red invalid state on every keystroke.
 */
function describeHint(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = tryParsePlusCode(trimmed);
  if (parsed === null) return null; // schema-side error will catch it
  if (parsed.kind === 'local' && parsed.reference === null) {
    return 'Local Plus Code — add an anchor, e.g. MP7J+CV Minato City, Tokyo';
  }
  return null;
}
