/** Binary units, because that is what a disk, a download and VRAM are measured in. */
export function formatBytes(n: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * A meeting's length: "47 min", "1h 34m".
 *
 * Minutes, not seconds. Nobody remembers a meeting as having run 47m 12s, and
 * the seconds would be the one figure in a row of titles that changes on
 * every meeting, pulling the eye to it.
 */
export function formatMeetingLength(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
