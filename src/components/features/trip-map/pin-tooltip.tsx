import type { TripMapPin } from '@/lib/trip-map/repo';
import { cn } from '@/lib/utils';

interface PinTooltipProps {
  /** Cursor x relative to the map container. */
  x: number;
  /** Cursor y relative to the map container. */
  y: number;
  containerWidth: number;
  containerHeight: number;
  pin: TripMapPin;
}

// "Mon 15 May 2026" — UTC-based to match the storage TZ semantics
// of `timestamptz` `mode: 'date'`. Keeps a flight on May 15 from
// rendering as May 14 in west-of-UTC sessions.
function formatPinDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Floating card driven by the cursor. Biases up-and-right of the
 * pointer and flips across an axis near container edges so it stays
 * readable in any corner. Same pattern as the world-map tooltip.
 */
export function PinTooltip({ x, y, containerWidth, containerHeight, pin }: PinTooltipProps) {
  const flipX = x > 0.65 * containerWidth ? -100 : 0;
  const flipY = y < 0.18 * containerHeight ? 12 : -100;

  const captionParts: string[] = [];
  if (pin.sublabel) captionParts.push(pin.sublabel);
  // Prefer the server-built compact range ("1–5 Jun") over the
  // single-date format when present — hotels carry a stay range, not
  // a point-in-time. Falls back to the original "Mon 15 May 2026"
  // for kinds that don't compute a dateLabel.
  if (pin.dateLabel) {
    captionParts.push(pin.dateLabel);
  } else if (pin.date) {
    captionParts.push(formatPinDate(pin.date));
  }

  return (
    <div
      role="tooltip"
      className={cn(
        'pointer-events-none absolute z-10 max-w-[14rem] rounded-lg border px-3 py-2',
        'border-foreground/15 bg-card/95 shadow-[0_10px_24px_-12px_rgba(60,40,20,0.35)] backdrop-blur-sm',
      )}
      style={{
        left: x,
        top: y,
        transform: `translate(calc(${flipX}% + ${flipX === 0 ? 14 : -14}px), calc(${flipY}% + ${flipY > 0 ? 14 : -14}px))`,
      }}
    >
      <p className="font-display text-foreground text-sm leading-tight font-medium tracking-tight">
        {pin.label}
      </p>
      {captionParts.length > 0 && (
        <p className="text-muted-foreground mt-1 font-mono text-[10px] tracking-[0.18em] uppercase">
          {captionParts.join(' · ')}
        </p>
      )}
    </div>
  );
}
