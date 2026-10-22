interface TabHeaderProps {
  eyebrow: string;
  count: number;
  // Right-aligned action(s) — typically a SegmentFormDialog trigger.
  action?: React.ReactNode;
}

// Header for the type-specific tabs: the tab's name and count on the left,
// the action on the right — the same shape as the itinerary's header.
export function TabHeader({ eyebrow, count, action }: TabHeaderProps) {
  return (
    <header
      className="atlas-rise mb-6 flex flex-wrap items-center gap-3 sm:mb-7"
      style={{ animationDelay: '240ms' }}
    >
      <h2 className="heading-section">{eyebrow}</h2>
      <span className="text-muted-foreground font-mono text-xs tracking-[0.06em] uppercase">
        {count}
      </span>
      {action && <div className="ml-auto">{action}</div>}
    </header>
  );
}
