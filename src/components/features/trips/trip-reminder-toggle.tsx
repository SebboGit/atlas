'use client';

import { Bell, BellOff } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { setTripReminderMuteAction } from '@/lib/notifications/actions';

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
}: {
  tripId: string;
  initialMuted: boolean;
  className?: string;
}) {
  const [muted, setMuted] = React.useState(initialMuted);
  const [pending, startTransition] = React.useTransition();

  function toggle() {
    const next = !muted;
    setMuted(next);
    startTransition(async () => {
      const result = await setTripReminderMuteAction({ tripId, muted: next });
      if (!result.ok) setMuted(!next);
    });
  }

  const Icon = muted ? BellOff : Bell;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggle}
      disabled={pending}
      aria-pressed={muted}
      className={className}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
      <span>{muted ? 'Reminders muted' : 'Mute reminders'}</span>
    </Button>
  );
}
