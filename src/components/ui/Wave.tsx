/**
 * A row of level bars: a meeting's loudness, or the mic check as it happens.
 *
 * Bars rather than a drawn line, and filled with `--fill-active`, so each
 * theme's meter treatment — solid, dithered, a hue ramp — reaches this too
 * with no fork here. Plain elements with a height each: a few dozen of them
 * cost nothing, where a canvas would be a render loop for a row of rectangles.
 */
export function Wave({
  levels,
  playhead = false,
  breathing = false,
  height = "h-12",
  label,
}: {
  /** 0..1 per bar. */
  levels: number[];
  /** A slow cursor across the bars, for a recording played back. */
  playhead?: boolean;
  /** For the resting line: quietly alive rather than still. */
  breathing?: boolean;
  height?: string;
  label: string;
}) {
  return (
    <div role="img" aria-label={label} className={`relative flex items-end gap-[2px] ${height}`}>
      {levels.map((l, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: bars are positions, not items
          key={i}
          className={`trace-wave-bar flex-1 rounded-[1px] ${breathing ? "trace-breathe" : ""}`}
          style={{ height: `${Math.max(4, Math.min(1, l) * 100)}%` }}
        />
      ))}
      {playhead && <span aria-hidden className="trace-playhead" />}
    </div>
  );
}
