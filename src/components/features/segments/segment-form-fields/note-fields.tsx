'use client';

import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { FieldError, getDataErrors, type Form } from './_helpers';

export function NoteFields({ form }: { form: Form }) {
  const e = getDataErrors(form.formState.errors);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="seg-body">Note</Label>
      <Textarea
        id="seg-body"
        rows={5}
        placeholder="Pick up cherry-blossom guide from the concierge."
        aria-invalid={!!e.body || undefined}
        {...form.register('data.body' as never)}
      />
      {e.body?.message && <FieldError>{e.body.message}</FieldError>}
    </div>
  );
}
