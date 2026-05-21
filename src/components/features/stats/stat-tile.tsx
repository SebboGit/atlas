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
      <CardContent className="flex h-full flex-col gap-3 p-6">
        <p className="text-foreground/55 flex items-center gap-2.5 font-mono text-[10px] tracking-[0.28em] uppercase">
          <span aria-hidden className="bg-foreground/25 h-px w-5" />
          <span>{label}</span>
        </p>
        <p className="font-display text-foreground flex items-baseline gap-1.5 leading-none">
          <span className="text-5xl font-medium tracking-tight tabular-nums sm:text-6xl">
            {value}
          </span>
          {unit ? (
            <span className="text-foreground/55 text-lg font-medium tracking-tight">{unit}</span>
          ) : null}
        </p>
        {caption ? (
          <p className="text-muted-foreground mt-auto text-sm leading-relaxed">{caption}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
