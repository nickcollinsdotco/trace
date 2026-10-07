/**
 * The numbers behind the signal panel, kept apart from its markup so they
 * can be tested without a DOM.
 */

import type { NoteSummary } from "../../lib/ipc";

/** Block characters as the backend writes them, quietest first. */
const BLOCKS = "▁▂▃▄▅▆▇█";

/** An envelope as heights 0..1, one per column. Unknown characters are the floor. */
export function heights(signal: string): number[] {
  return [...signal].map((c) => (Math.max(0, BLOCKS.indexOf(c)) + 1) / BLOCKS.length);
}

/**
 * A resting line for a library with no recorded shape yet: two slow sines,
 * so it reads as a quiet carrier rather than as a meeting that happened.
 */
export function idleHeights(columns = 48): number[] {
  return Array.from(
    { length: columns },
    (_, i) => 0.22 + 0.12 * Math.sin(i * 0.42) + 0.06 * Math.sin(i * 1.3 + 1),
  );
}

/** Local `YYYY-MM-DD`, the form a note's date is written in. */
export function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface WeekDay {
  /** One letter, M to S. */
  label: string;
  iso: string;
  count: number;
  today: boolean;
}

/** The Monday of the week `back` weeks before the one `now` is in. */
export function mondayOf(now: Date, back = 0): Date {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - back * 7);
  return monday;
}

/** Meetings per day, by `YYYY-MM-DD`. */
function countByDay(notes: NoteSummary[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of notes) counts.set(n.date, (counts.get(n.date) ?? 0) + 1);
  return counts;
}

/**
 * A week, Monday first, with how many meetings fell on each day: this one,
 * or `back` weeks before it.
 */
export function thisWeek(notes: NoteSummary[], now: Date = new Date(), back = 0): WeekDay[] {
  const monday = mondayOf(now, back);
  const today = isoDay(now);
  const counts = countByDay(notes);

  return "MTWTFSS".split("").map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = isoDay(d);
    return { label, iso, count: counts.get(iso) ?? 0, today: iso === today };
  });
}

/**
 * How far back there is anything to see, in weeks: the week of the oldest
 * meeting. Zero for an empty library, so the arrows have nowhere to go.
 */
export function weeksOnFile(notes: NoteSummary[], now: Date = new Date()): number {
  const thisMonday = mondayOf(now).getTime();
  let back = 0;
  for (const n of notes) {
    const [y, m, d] = n.date.split("-").map(Number);
    if (!y || !m || !d) continue;
    const monday = mondayOf(new Date(y, m - 1, d)).getTime();
    // Rounded: a week that crosses the clocks changing is not quite 7 days.
    back = Math.max(back, Math.round((thisMonday - monday) / (7 * 86_400_000)));
  }
  return back;
}

/** ISO 8601 week number: the week with the year's first Thursday is 1. */
export function isoWeek(d: Date): number {
  // In UTC, so no clock change makes a day 23 hours long.
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - jan1) / 86_400_000 + 1) / 7);
}

export interface HeatDay {
  iso: string;
  count: number;
  /** After today: drawn as nothing, not as a quiet day. */
  future: boolean;
}

export interface HeatWeek {
  /** How many weeks before this one; zero is this week. */
  back: number;
  monday: string;
  days: HeatDay[];
  total: number;
  /** The month's short name, on the first week that holds its 1st. */
  month: string | null;
}

/**
 * The last `weeks` weeks as columns of seven days, oldest first: the grid a
 * contribution graph draws.
 */
export function yearGrid(notes: NoteSummary[], now: Date = new Date(), weeks = 53): HeatWeek[] {
  const counts = countByDay(notes);
  const today = isoDay(now);
  return Array.from({ length: weeks }, (_, i) => {
    const back = weeks - 1 - i;
    const monday = mondayOf(now, back);
    let month: string | null = null;
    const days = Array.from({ length: 7 }, (_, j) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + j);
      const iso = isoDay(d);
      if (d.getDate() === 1 || (i === 0 && j === 0)) {
        month = d.toLocaleDateString(undefined, { month: "short" });
      }
      return { iso, count: counts.get(iso) ?? 0, future: iso > today };
    });
    return {
      back,
      monday: isoDay(monday),
      days,
      total: days.reduce((sum, d) => sum + d.count, 0),
      month,
    };
  });
}

/** How dark a day's square is: 0 for none, up to 4 for four or more. */
export function heatLevel(count: number): number {
  return Math.min(4, Math.max(0, count));
}

export interface YearStats {
  meetings: number;
  /** Days with at least one meeting. */
  days: number;
  /** The most days in a row with a meeting, weekends not breaking it. */
  streak: number;
  busiest: HeatWeek | null;
}

export function yearStats(grid: HeatWeek[]): YearStats {
  let meetings = 0;
  let days = 0;
  let streak = 0;
  let run = 0;
  let busiest: HeatWeek | null = null;
  for (const week of grid) {
    meetings += week.total;
    if (week.total > 0 && (busiest === null || week.total > busiest.total)) busiest = week;
    week.days.forEach((d, i) => {
      if (d.future) return;
      if (d.count > 0) {
        days += 1;
        run += 1;
        streak = Math.max(streak, run);
      } else if (i < 5) {
        // A weekday without one ends the run; a quiet weekend does not.
        run = 0;
      }
    });
  }
  return { meetings, days, streak, busiest };
}

export interface WeekStats {
  meetings: number;
  totalMs: number;
  longest: NoteSummary | null;
}

export function weekStats(notes: NoteSummary[], now: Date = new Date(), back = 0): WeekStats {
  const days = new Set(thisWeek(notes, now, back).map((d) => d.iso));
  const inWeek = notes.filter((n) => days.has(n.date));
  let longest: NoteSummary | null = null;
  for (const n of inWeek) {
    if (n.durationMs !== null && (longest === null || n.durationMs > (longest.durationMs ?? 0))) {
      longest = n;
    }
  }
  return {
    meetings: inWeek.length,
    totalMs: inWeek.reduce((sum, n) => sum + (n.durationMs ?? 0), 0),
    longest,
  };
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function ago(fromMs: number, nowMs: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((nowMs - fromMs) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** When the newest meeting ended, if its times are known. */
export function lastTraceEnded(notes: NoteSummary[]): number | null {
  const latest = notes.find((n) => n.startedAt !== null);
  if (!latest?.startedAt) return null;
  const started = Date.parse(latest.startedAt);
  if (Number.isNaN(started)) return null;
  return started + (latest.durationMs ?? 0);
}

/** A round number of meetings, marked once it is reached. */
export function milestone(count: number): number | null {
  return count > 0 && count % 25 === 0 ? count : null;
}
