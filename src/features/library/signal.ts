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

/** This week, Monday first, with how many meetings fell on each day. */
export function thisWeek(notes: NoteSummary[], now: Date = new Date()): WeekDay[] {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const today = isoDay(now);

  return "MTWTFSS".split("").map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = isoDay(d);
    return { label, iso, count: notes.filter((n) => n.date === iso).length, today: iso === today };
  });
}

export interface WeekStats {
  meetings: number;
  totalMs: number;
  longest: NoteSummary | null;
}

export function weekStats(notes: NoteSummary[], now: Date = new Date()): WeekStats {
  const days = new Set(thisWeek(notes, now).map((d) => d.iso));
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
