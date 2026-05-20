import type { UngeocodedSegment } from '@/lib/trip-map/repo';

interface UngeocodedListProps {
  items: UngeocodedSegment[];
}

/**
 * Quiet list rendered below the map when one or more segments
 * couldn't be placed. Deliberately not styled as an error state —
 * for Phase 3a most non-flight segments will land here, and that's
 * information, not a failure.
 */
export function UngeocodedList({ items }: UngeocodedListProps) {
  return (
    <section
      className="atlas-rise mt-6"
      style={{ animationDelay: '240ms' }}
      aria-label="Segments not on the map"
    >
      <div className="mb-3 flex items-center gap-3">
        <p className="text-foreground/70 font-mono text-[10px] tracking-[0.28em] uppercase">
          Not on the map
        </p>
        <span className="text-foreground/40 font-mono text-[10px] tracking-[0.2em]">
          · {String(items.length).padStart(2, '0')}
        </span>
        <span aria-hidden className="bg-foreground/15 hidden h-px flex-1 sm:block" />
      </div>
      <ul className="divide-foreground/8 border-foreground/8 divide-y border-y">
        {items.map((item) => (
          <li
            key={item.segmentId}
            className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <span className="text-foreground/90 text-sm font-medium">{item.label}</span>
            <span className="text-muted-foreground text-sm leading-relaxed">{item.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
