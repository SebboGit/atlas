interface TabHeaderProps {
  eyebrow: string;
  count: number;
  // Right-aligned action(s) — typically a SegmentFormDialog trigger.
  action?: React.ReactNode;
}

// Quiet, ruled header for the type-specific tabs. Eyebrow on the
// left, the count beside it, action on the right. Aligns visually
// with the itinerary's day-group eyebrows (same mono-uppercase
// tracking, same hairline rule).
export function TabHeader({ eyebrow, count, action }: TabHeaderProps) {
  return (
    <header
      className="atlas-rise mb-6 flex flex-wrap items-center gap-3 sm:mb-7"
      style={{ animationDelay: '240ms' }}
    >
      <p className="text-foreground/70 font-mono text-[10px] tracking-[0.28em] uppercase">
        {eyebrow}
      </p>
      <span className="text-foreground/40 font-mono text-[10px] tracking-[0.2em]">
        · {String(count).padStart(2, '0')}
      </span>
      <span aria-hidden className="bg-foreground/15 hidden h-px flex-1 sm:block" />
      {action && <div className="ml-auto sm:ml-0">{action}</div>}
    </header>
  );
}
