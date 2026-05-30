// The map tab renders a full-bleed surface; this fills the same footprint
// with a quiet pulse and the shared ø glyph so the swap to the live map
// doesn't jump.
export default function TripMapLoading() {
  return (
    <div className="bg-muted/40 atlas-rise relative flex min-h-[70vh] w-full flex-1 items-center justify-center overflow-hidden">
      <div aria-hidden className="bg-muted/55 absolute inset-0 animate-pulse" />
      <div className="relative flex flex-col items-center gap-4 text-center">
        <span className="border-foreground/25 text-foreground/70 inline-flex h-10 w-10 items-center justify-center rounded-full border font-mono text-[10px] tracking-[0.2em]">
          ø
        </span>
        <p className="text-muted-foreground font-mono text-[10px] tracking-[0.2em] uppercase">
          Loading map
        </p>
      </div>
      <span className="sr-only">Loading trip map…</span>
    </div>
  );
}
