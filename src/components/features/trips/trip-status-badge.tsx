import { cn } from '@/lib/utils';
import type { TripStatus } from '@/lib/trips';

// Active is the one coral state; planned is an ink outline so it still reads
// as "ahead"; completed and archived recede.
const STYLES: Record<TripStatus, string> = {
  planned: 'border-foreground text-foreground',
  active: 'border-transparent bg-primary text-primary-foreground',
  completed: 'border-transparent bg-muted text-muted-foreground',
  archived: 'border-border text-muted-foreground line-through decoration-foreground/30',
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium tracking-[0.06em] uppercase',
        STYLES[status],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}
