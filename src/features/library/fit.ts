/**
 * Which tags fit on the library's bar, measured rather than counted.
 *
 * A fixed five overflowed a narrow window and wasted a wide one, and a tag
 * is as long as whatever someone typed. Every pill is measured off-screen,
 * then as many as fit are shown in order, with room kept for "+N more".
 *
 * `pinned` is the tag asked for. It is always shown, at the end of the run,
 * so a tag picked from the overflow does not vanish into it the moment it
 * is chosen.
 */
export function fitTags(
  widths: number[],
  { space, gap, more }: { space: number; gap: number; more: number },
  pinned?: number,
): number[] {
  const all = widths.map((_, i) => i);
  const total = widths.reduce((sum, w) => sum + gap + w, 0);
  if (total <= space) return all;

  let room = space - (gap + more);
  if (pinned !== undefined) room -= gap + (widths[pinned] ?? 0);
  const shown: number[] = [];
  for (const i of all) {
    if (i === pinned) continue;
    const need = gap + (widths[i] ?? 0);
    if (need > room) break;
    room -= need;
    shown.push(i);
  }
  if (pinned !== undefined) shown.push(pinned);
  return shown;
}
