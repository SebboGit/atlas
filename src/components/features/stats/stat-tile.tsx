import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A lifetime headline tile: a hairline-ruled monospace label, one large
 * Fraunces figure, and a quiet sentence underneath. The voice is
 * memory-tool, not KPI — the caption is a full clause ("Last new one:
 * Vietnam, March 2025"), never a delta chip.
 */
export function StatTile({
  label,
  value,
  unit,
  caption,
  className,
}: {
  /** Monospace eyebrow, e.g. "Countries". Rendered uppercase. */
  label: string;
  /** The headline figure — already formatted (grouped digits etc.). */
  value: string;
  /** Optional small unit trailing the figure, e.g. "km". */
  unit?: string;
  /** A full sentence underneath. Omitted when there's nothing to say. */
  caption?: string;
  className?: string;
}) {
  return (
    <Card variant="paper" className={cn('h-full', className)}>
      <CardContent className="flex h-full flex-col gap-2.5 p-4 sm:gap-3 sm:p-6">
        <p className="text-foreground/90 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.16em] uppercase sm:text-xs sm:tracking-[0.24em]">
          <span aria-hidden className="bg-foreground/30 h-px w-5" />
          <span>{label}</span>
        </p>
        {/* flex-wrap so a long figure + unit (e.g. "39 997 km") drops the
         *  unit to a second line on a narrow tile instead of crowding the
         *  card edge; the grouped figure itself uses U+202F and won't break. */}
        <p className="font-display text-foreground flex flex-wrap items-baseline gap-x-1.5 leading-none">
          <span className="text-2xl font-medium tracking-tight tabular-nums sm:text-6xl">
            {value}
          </span>
          {unit ? (
            <span className="text-foreground/70 text-base font-medium tracking-tight sm:text-lg">
              {unit}
            </span>
          ) : null}
        </p>
        {/* Caption is supporting context — dropped entirely on phone, where
         *  the label + figure carry the tile, and shown from sm: up where
         *  there's room. */}
        {caption ? (
          <p className="text-muted-foreground mt-auto hidden text-sm leading-relaxed sm:block">
            {caption}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
