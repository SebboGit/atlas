'use client';

import { Bell, BellOff } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { setTripReminderMuteAction } from '@/lib/notifications/actions';
import { cn } from '@/lib/utils';

/**
 * Per-user mute for a trip's reminders (ADR-0020). Rendered for every
 * member who can see the trip — muting a shared trip silences only the
 * person who pressed it — and only when that person has notifications
 * switched on, so it never offers to mute something that isn't sent.
 */
export function TripReminderToggle({
  tripId,
  initialMuted,
  className,
  statusClassName,
}: {
  tripId: string;
  initialMuted: boolean;
  className?: string;
  /** Colour for the "Not saved." line — the trip banner passes its inverse accent. */
  statusClassName?: string;
}) {
  const [muted, setMuted] = React.useState(initialMuted);
  const [failed, setFailed] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function toggle() {
    const next = !muted;
    setMuted(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setTripReminderMuteAction({ tripId, muted: next });
      if (!result.ok) {
        setMuted(!next);
        setFailed(true);
      }
    });
  }

  const Icon = muted ? BellOff : Bell;
  // The label states the current state and changes with it, so there is
  // no `aria-pressed` on top — a screen reader would announce the state
  // twice ("Reminders muted, pressed").
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={toggle}
        disabled={pending}
        className={className}
      >
        <Icon className="size-3.5" strokeWidth={1.75} />
        <span>{muted ? 'Reminders muted' : 'Mute reminders'}</span>
      </Button>
      <span role="status" className={cn('text-destructive text-xs', statusClassName)}>
        {failed ? 'Not saved.' : null}
      </span>
    </span>
  );
}
