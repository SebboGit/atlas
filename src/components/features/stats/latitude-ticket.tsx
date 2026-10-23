import { Compass } from 'lucide-react';

import { Card } from '@/components/ui/card';
import type { PersonalRecords } from '@/lib/stats';
import { layoutLatitude, type LatitudeLabel } from '@/lib/stats/latitude';
import { placeName } from '@/lib/stats/places';
import { cn } from '@/lib/utils';

import { STRIP_LABEL } from './styles';

/**
 * Narrowest track the 30° ticks are drawn on, px: the ticket body at the
 * `sm:` floor — a 640px page less its 2×32px gutter (576), the 160px stub,
 * its 2px perforation and the body's 32px + 44px padding. The ticks are
 * hidden below `sm:`, and a wider track only spreads them further apart.
 */
const TICK_TRACK_WIDTH = 338;

type Extreme = PersonalRecords['northernmost'];

/**
 * The latitude record: a south-to-north line with the equator marked in
 * coral at its centre, an ink bar between the furthest-south and
 * furthest-north markers, and each extreme labelled directly above its
 * marker. The scale is symmetric (±60° unless a point lies further out,
 * see `layoutLatitude`), so two northern extremes simply sit on the right.
 * The stub is the inverse surface with the span in degrees.
 */
export function LatitudeTicket({ south, north }: { south: Extreme; north: Extreme }) {
  const layout = layoutLatitude(
    south && { ...south, label: placeName(south.label) },
    north && { ...north, label: placeName(north.label) },
    TICK_TRACK_WIDTH,
  );
  if (!layout) return null;

  const span = layout.span === null ? null : `${layout.span.toFixed(1)}°`;
  const [first, second] = layout.labels;

  return (
    <Card variant="paper" className="flex flex-col overflow-hidden sm:min-h-[12.5rem] sm:flex-row">
      <div className="ticket-stub bg-inverse text-inverse-foreground flex h-12 shrink-0 items-center justify-between gap-3 px-4 [--color-perforation:var(--color-inverse-line)] sm:h-auto sm:w-40 sm:flex-col sm:items-start sm:px-5 sm:py-5">
        <span className={cn(STRIP_LABEL, 'sm:hidden')}>
          <Compass aria-hidden className="size-3.5" strokeWidth={2} />
          Latitude
        </span>
        {span && (
          <span className="text-xl font-bold whitespace-nowrap sm:hidden">
            {span}
            <span className={cn(STRIP_LABEL, 'ml-1 inline')}>span</span>
          </span>
        )}
        <Compass aria-hidden className="hidden size-[22px] sm:block" strokeWidth={1.75} />
        <div className="hidden sm:block">
          {span ? (
            <>
              <p className="text-[1.875rem] leading-none font-bold tracking-[-0.03em] whitespace-nowrap">
                {span}
              </p>
              <p className="mt-1.5 text-base font-semibold">span</p>
            </>
          ) : (
            <p className="text-base font-semibold">Latitude</p>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 px-4 pt-4 pb-[1.125rem] sm:pt-[1.375rem] sm:pr-11 sm:pb-5 sm:pl-8">
        <div role="img" aria-label={layout.description} className="flex flex-col">
          {/* Labels in one row: spacers sized to the marker positions shrink
           *  when the labels need the room, so two close extremes push each
           *  other apart and neither runs off the ticket. */}
          <div className="flex items-end">
            <span className="min-w-0" style={{ flex: `0 1 ${layout.leadSpacer}%` }} />
            {first && <ExtremeLabel label={first} />}
            <span
              className={cn('min-w-4 flex-1', !second && first?.anchor === 'end' && 'order-first')}
            />
            {second && <ExtremeLabel label={second} />}
            <span className="min-w-0" style={{ flex: `0 1 ${layout.trailSpacer}%` }} />
          </div>

          <div className="relative mt-4 h-[26px] sm:mt-3">
            <span className="bg-border absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2" />
            {layout.bar && (
              <span
                className="bg-foreground absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
                style={{ left: `${layout.bar.from}%`, right: `${100 - layout.bar.to}%` }}
              />
            )}
            <span className="bg-primary absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2" />
            {layout.labels.map((l) => (
              <span key={l.caption}>
                {/* Phone: a hairline from the label down to its marker. */}
                <span
                  className="bg-input absolute -top-3.5 h-3.5 w-px sm:hidden"
                  style={{ left: `${l.pct}%` }}
                />
                <span
                  className="bg-card absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[inset_0_0_0_4px_var(--color-foreground)]"
                  style={{ left: `${l.pct}%` }}
                />
              </span>
            ))}
          </div>

          <div className="relative mt-2 h-5">
            <span className="text-coral-ink absolute left-1/2 -translate-x-1/2 font-mono text-[10px] font-medium tracking-[0.08em] uppercase sm:font-sans sm:text-sm sm:font-semibold sm:tracking-normal sm:normal-case">
              Equator
            </span>
            {layout.ticks.map((t) => (
              <span
                key={t.lat}
                className="text-muted-foreground absolute hidden -translate-x-1/2 font-mono text-xs sm:block"
                style={{ left: `${t.pct}%` }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ExtremeLabel({ label }: { label: LatitudeLabel }) {
  return (
    <div
      className={cn(
        'flex max-w-[calc(50%-0.5rem)] shrink-0 flex-col',
        label.anchor === 'end' && 'items-end text-right',
      )}
    >
      <span className="text-muted-foreground hidden text-base sm:block">{label.caption}</span>
      <span className="text-xl leading-none font-bold tracking-[-0.02em] whitespace-nowrap sm:mt-1.5 sm:text-[1.75rem]">
        {label.value}
      </span>
      <span className="text-muted-foreground mt-[3px] max-w-full truncate text-xs sm:mt-1.5 sm:text-[0.9375rem]">
        {label.place}
      </span>
    </div>
  );
}
