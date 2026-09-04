/**
 * Date grouping for the meeting library.
 *
 * docs/04-UX.md asks for "Today / Yesterday / This month" grouping rather than
 * a dashboard or a metadata-heavy card grid. This is that rule, isolated and
 * testable, so the list component stays presentational.
 */

export type DateGroup = "Today" | "Yesterday" | "This week" | "This month" | "Earlier";

const DAY_MS = 86_400_000;

/** Midnight-anchored day index, so grouping is calendar-based not 24h-based. */
function dayIndex(d: Date): number {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY_MS);
}

/**
 * @param isoDate `YYYY-MM-DD` from `Meeting.date`
 * @param now injectable for tests; defaults to the current time
 */
export function groupForDate(isoDate: string, now: Date = new Date()): DateGroup {
  // Parse as local midnight. `new Date("2026-09-04")` would parse as UTC and
  // shift the day for anyone west of Greenwich.
  const parts = isoDate.split("-").map(Number);
  const [y, m, d] = parts;
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y)) {
    return "Earlier";
  }

  const delta = dayIndex(now) - dayIndex(new Date(y, m - 1, d));

  if (delta <= 0) return "Today";
  if (delta === 1) return "Yesterday";
  if (delta < 7) return "This week";
  if (delta < 31) return "This month";
  return "Earlier";
}

const GROUP_ORDER: DateGroup[] = ["Today", "Yesterday", "This week", "This month", "Earlier"];

/**
 * Groups items by date, newest first within each group, and returns only
 * non-empty groups in display order.
 */
export function groupByDate<T>(
  items: T[],
  getDate: (item: T) => string,
  now: Date = new Date(),
): Array<{ group: DateGroup; items: T[] }> {
  const buckets = new Map<DateGroup, T[]>();

  for (const item of items) {
    const group = groupForDate(getDate(item), now);
    const bucket = buckets.get(group);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(group, [item]);
    }
  }

  return GROUP_ORDER.flatMap((group) => {
    const bucketItems = buckets.get(group);
    if (!bucketItems || bucketItems.length === 0) return [];
    const sorted = [...bucketItems].sort((a, b) => getDate(b).localeCompare(getDate(a)));
    return [{ group, items: sorted }];
  });
}
