'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm, useWatch, type UseFormRegisterReturn } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  sendTestNotificationAction,
  updateNotificationSettingsAction,
  type SettingsFormError,
} from '@/lib/notifications/actions';
import { notificationSettingsInput } from '@/lib/notifications/validators';

type FormInput = z.input<typeof notificationSettingsInput>;
type FormOutput = z.output<typeof notificationSettingsInput>;

interface NotificationSettingsFormProps {
  initial: FormInput;
  /** The deployment default topic, shown as the field's placeholder. */
  defaultTopic: string | null;
}

type Status = { tone: 'ok' | 'error'; text: string } | null;

export function NotificationSettingsForm({ initial, defaultTopic }: NotificationSettingsFormProps) {
  const [status, setStatus] = React.useState<Status>(null);
  const [saving, startSave] = React.useTransition();
  const [testing, startTest] = React.useTransition();

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(notificationSettingsInput),
    defaultValues: initial,
  });
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = form;
  const enabled = useWatch({ control: form.control, name: 'enabled' });

  function applyError(error: SettingsFormError) {
    setStatus(error.formMessage ? { tone: 'error', text: error.formMessage } : null);
    for (const [name, message] of Object.entries(error.fields ?? {})) {
      if (name === 'topic') setError('topic', { type: 'server', message });
    }
  }

  function save(values: FormOutput) {
    setStatus(null);
    startSave(async () => {
      const result = await updateNotificationSettingsAction(values);
      if (result.ok) {
        // Re-baseline so the test button reads the values just saved.
        reset({ ...values, topic: values.topic ?? '' });
        setStatus({ tone: 'ok', text: 'Saved.' });
      } else {
        applyError(result.error);
      }
    });
  }

  function sendTest() {
    setStatus(null);
    startTest(async () => {
      const result = await sendTestNotificationAction();
      if (result.ok) setStatus({ tone: 'ok', text: 'Test sent.' });
      else applyError(result.error);
    });
  }

  const topicErr = errors.topic?.message;

  return (
    <form
      noValidate
      // Clear a stale "Test sent." when client validation stops the save.
      onSubmit={handleSubmit(save, () => setStatus(null))}
      className="flex flex-col gap-6"
    >
      <ToggleRow
        id="notifications-enabled"
        label="Push notifications"
        hint="Sent to your ntfy topic."
        registration={register('enabled')}
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor="notifications-topic">Topic</Label>
        <Input
          id="notifications-topic"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={defaultTopic ?? 'Topic name'}
          aria-invalid={!!topicErr || undefined}
          aria-describedby="notifications-topic-hint"
          className="font-mono"
          {...register('topic')}
        />
        {topicErr ? (
          <p
            id="notifications-topic-hint"
            role="alert"
            className="text-destructive text-xs leading-snug"
          >
            {topicErr}
          </p>
        ) : (
          <p id="notifications-topic-hint" className="text-muted-foreground text-xs leading-snug">
            {defaultTopic ? 'Empty uses the server default.' : 'Required — no server default.'}
          </p>
        )}
      </div>

      {/* Dimmed, not `disabled`: react-hook-form reads a disabled input as
       *  undefined, and the prefs schema would then default it back to on,
       *  silently undoing a switch the user turned off. */}
      <fieldset className={enabled ? 'flex flex-col gap-1' : 'flex flex-col gap-1 opacity-50'}>
        <legend className="text-foreground/70 mb-2 font-mono text-[10px] tracking-[0.28em] uppercase">
          Send me
        </legend>
        <ToggleRow
          id="notifications-extraction"
          label="Document reading"
          hint="Finished or failed."
          registration={register('prefs.extraction')}
        />
      </fieldset>

      <div className="border-foreground/10 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center">
        <Button type="submit" disabled={saving || !isDirty} className="h-11 sm:h-10">
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={sendTest}
          // Tests the SAVED topic — unsaved edits would make the result lie.
          disabled={testing || isDirty}
          className="h-11 sm:h-10"
        >
          {testing ? 'Sending…' : 'Send test'}
        </Button>
        <p
          role="status"
          aria-live="polite"
          className={
            status?.tone === 'error'
              ? 'text-destructive text-sm sm:ml-2'
              : 'text-muted-foreground text-sm sm:ml-2'
          }
        >
          {status?.text}
        </p>
      </div>
    </form>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  registration,
}: {
  id: string;
  label: string;
  hint: string;
  registration: UseFormRegisterReturn;
}) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5">
      <input
        id={id}
        type="checkbox"
        className="border-foreground/30 text-primary accent-primary focus-visible:ring-primary/40 focus-visible:ring-offset-background mt-0.5 size-4 shrink-0 rounded border bg-transparent transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        {...registration}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-foreground text-sm">{label}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </span>
    </label>
  );
}
