import { Card, CardContent } from '@/components/ui/card';

interface ComingSoonTabProps {
  title: string;
  description: string;
  previewItems?: string[];
}

// Editorial "on the press" placeholder for the four type-specific tabs.
// Telegraphs the planned shape without pretending data exists. Same
// decorative topographic contour pattern used in the trips list empty
// state, for consistency.
export function ComingSoonTab({ title, description, previewItems }: ComingSoonTabProps) {
  return (
    <div className="atlas-rise" style={{ animationDelay: '240ms' }}>
      <Card variant="paper" className="relative overflow-hidden">
        {/* Faint topographic decoration — atmosphere, not information. */}
        <svg
          aria-hidden
          className="text-foreground/8 pointer-events-none absolute -right-20 -bottom-24 h-72 w-72"
          viewBox="0 0 200 200"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
        >
          {Array.from({ length: 11 }).map((_, i) => (
            <ellipse
              key={i}
              cx="100"
              cy="100"
              rx={18 + i * 8}
              ry={12 + i * 7}
              transform={`rotate(${-14 + i * 1.6} 100 100)`}
            />
          ))}
        </svg>

        <CardContent className="relative grid gap-10 px-7 py-12 sm:grid-cols-[1fr_1.1fr] sm:px-9 sm:py-14">
          <div>
            <p className="text-foreground/55 mb-4 font-mono text-[10px] tracking-[0.28em] uppercase">
              On the press
            </p>
            <h2 className="font-display text-foreground text-4xl leading-[1.05] tracking-tight sm:text-5xl">
              {title}
            </h2>
            <p className="text-muted-foreground mt-5 max-w-sm text-sm leading-relaxed">
              {description}
            </p>
          </div>
          {previewItems && (
            <ol className="border-foreground/15 space-y-2 self-center border-l pl-5">
              {previewItems.map((line, i) => (
                <li
                  key={i}
                  className="text-foreground/70 flex items-baseline gap-3 font-mono text-[11px] tracking-wider"
                >
                  <span className="text-foreground/35">{String(i + 1).padStart(2, '0')}</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
