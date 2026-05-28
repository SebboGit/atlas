import { Card, CardContent } from '@/components/ui/card';
import type { YearTally } from '@/lib/stats';
import { cn } from '@/lib/utils';

// Beyond this many years the columns can't share the strip's width and
// stay legible — past it we let each column take a fixed width and the
// strip scroll horizontally. Below it the columns flex to fill the card.
const SCROLL_THRESHOLD = 6;

/**
 * A year-over-year strip: one labelled column per year with a quiet
 * vertical bar whose height tracks the count, the figure above it, the
 * 4-digit year below. No axes, no gridlines, no percentage chrome — it
 * reads as a row of marks in a logbook, not a chart.
 *
 * Bars are sized relative to the strip's own maximum so a sparse year
 * still shows a visible mark. Years with zero activity are simply
 * absent from `tallies` (the repo omits them).
 *
 * Scaling: this is a memory tool, so every year shows — the whole
 * history matters. Up to {@link SCROLL_THRESHOLD} years the columns
 * flex to fill the card. Beyond that, columns take a fixed minimum
 * width and the strip scrolls horizontally only when it genuinely
 * overflows; the 4-digit labels stay upright and non-overlapping
 * either way.
 */
export function YearStrip({
  label,
  tallies,
  accent = 'primary',
}: {
  label: string;
  tallies: YearTally[];
  /** Bar colour family. `primary` = terracotta, `accent` = sage olive. */
  accent?: 'primary' | 'accent';
}) {
  const max = tallies.reduce((m, t) => Math.max(m, t.count), 0);
  const barColor = accent === 'primary' ? 'bg-primary/70' : 'bg-accent/70';
  const isDense = tallies.length > SCROLL_THRESHOLD;

  return (
    <Card variant="paper" className="h-full">
      <CardContent className="flex h-full flex-col gap-4 p-6">
        <p className="text-foreground/70 flex items-center gap-2.5 font-mono text-[10px] tracking-[0.28em] uppercase">
          <span aria-hidden className="bg-foreground/25 h-px w-5" />
          <span>{label}</span>
        </p>

        {tallies.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing dated yet.</p>
        ) : (
          <ul
            className={cn(
              // A few years: flex to fill. Many years: each column takes
              // a fixed width and the row scrolls if it overflows.
              'mt-auto flex items-end overflow-x-auto pb-1',
              isDense ? 'gap-2' : 'gap-3',
            )}
          >
            {tallies.map((t) => (
              <li
                key={t.year}
                className={cn(
                  'flex flex-col items-center gap-2',
                  // Fixed width when dense (the column count drives the
                  // strip width and it scrolls); flex-fill when sparse.
                  isDense ? 'w-12 shrink-0' : 'min-w-9 flex-1',
                )}
              >
                <span className="font-display text-foreground text-lg leading-none font-medium tabular-nums">
                  {t.count}
                </span>
                <span
                  aria-hidden
                  className={cn('w-full rounded-full', barColor)}
                  style={{
                    // Floor the visible height so a non-zero year never
                    // collapses to an invisible sliver.
                    height: `${Math.max(6, max > 0 ? (t.count / max) * 56 : 6)}px`,
                  }}
                />
                <span className="text-foreground/70 font-mono text-[10px] tracking-[0.08em] tabular-nums">
                  {t.year}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
