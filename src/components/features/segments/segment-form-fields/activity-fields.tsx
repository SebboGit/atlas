'use client';

import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { FieldError, Optional, getDataErrors, type Form } from './_helpers';
import { PlusCodeFields, PlusCodeNudge } from './plus-code-fields';

export function ActivityFields({ form }: { form: Form }) {
  const e = getDataErrors(form.formState.errors);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-title">Title</Label>
        <Input
          id="seg-title"
          placeholder="TeamLab Planets"
          aria-invalid={!!e.title || undefined}
          {...form.register('data.title' as never)}
        />
        {e.title?.message && <FieldError>{e.title.message}</FieldError>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-desc">
          Notes <Optional />
        </Label>
        <Textarea
          id="seg-desc"
          rows={3}
          placeholder="Pre-booked timed entry."
          {...form.register('data.description' as never)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="seg-activity-address">
          Address <Optional />
        </Label>
        <Input
          id="seg-activity-address"
          placeholder="6-1-16 Toyosu, Koto"
          {...form.register('data.address' as never)}
        />
        <PlusCodeNudge form={form} />
      </div>
      <PlusCodeFields form={form} idPrefix="seg-activity" />
    </div>
  );
}
