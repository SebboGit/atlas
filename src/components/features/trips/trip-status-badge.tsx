import { cn } from '@/lib/utils';
import type { TripStatus } from '@/lib/trips';

const STYLES: Record<TripStatus, string> = {
  planned: 'border-foreground/30 text-foreground/75 bg-card/60',
  active: 'border-primary/60 text-primary bg-primary/12',
  completed: 'border-accent/55 text-accent bg-accent/12',
  archived:
    'border-foreground/20 text-foreground/50 bg-transparent line-through decoration-foreground/30',
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
        // Carries a touch more weight than a plain micro-label — slightly
        // larger, medium mono, a bolder dot — so the trip's state reads at
        // a glance everywhere it appears (cards, chrome, home hero).
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] font-medium tracking-[0.18em] uppercase',
        STYLES[status],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}
