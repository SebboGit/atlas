/**
 * One entry in the personal-records ledger: a hairline-ruled monospace
 * label with the value stacked directly beneath it in display serif,
 * and an optional quiet note.
 *
 * Stacking label-over-value — rather than flinging them to opposite
 * edges of a wide row — keeps each record tight, so the eye never has
 * to travel. The voice is a logbook entry, not a metric.
 *
 * Renders a plain block; RecordsPanel arranges the entries into two flex
 * columns (the non-latitude records on the left, the furthest north /
 * south pair kept together on the right).
 */
export function RecordEntry({
  label,
  value,
  note,
}: {
  label: string;
  /** The record itself — rendered in display serif. */
  value: string;
  /** Optional context line under the value. */
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <span className="text-foreground/70 font-mono text-[10px] tracking-[0.22em] whitespace-nowrap uppercase">
          {label}
        </span>
        <span aria-hidden className="bg-foreground/15 h-px flex-1" />
      </div>
      <p className="font-display text-foreground text-2xl leading-tight font-medium tracking-tight">
        {value}
      </p>
      {note ? <p className="text-muted-foreground text-xs leading-relaxed">{note}</p> : null}
    </div>
  );
}
