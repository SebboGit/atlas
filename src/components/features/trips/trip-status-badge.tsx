import { cn } from '@/lib/utils';
import type { TripStatus } from '@/lib/trips';

const STYLES: Record<TripStatus, string> = {
  planned: 'border-foreground/25 text-foreground/65 bg-card/40',
  active: 'border-primary/55 text-primary bg-primary/8',
  completed: 'border-accent/50 text-accent bg-accent/8',
  archived:
    'border-foreground/15 text-foreground/45 bg-transparent line-through decoration-foreground/30',
};

const LABELS: Record<TripStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

export function TripStatusBadge({ status, className }: { status: TripStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] tracking-[0.24em] uppercase',
        STYLES[status],
        className,
      )}
    >
      <span aria-hidden className="size-1 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}
