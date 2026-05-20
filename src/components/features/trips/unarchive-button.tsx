'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { unarchiveTripAction } from '@/lib/trips/actions';

export function UnarchiveButton({ tripId }: { tripId: string }) {
  const [pending, startTransition] = React.useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => unarchiveTripAction(tripId).then(() => undefined))}
    >
      {pending ? 'Restoring…' : 'Restore from archive'}
    </Button>
  );
}
