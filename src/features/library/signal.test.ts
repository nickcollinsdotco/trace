import { describe, expect, it } from "vitest";
import type { NoteSummary } from "../../lib/ipc";
import {
  ago,
  heatLevel,
  heights,
  isoWeek,
  milestone,
  thisWeek,
  weekStats,
  weeksOnFile,
  yearGrid,
  yearStats,
} from "./signal";

function note(date: string, durationMs: number | null, title = date): NoteSummary {
  return {
    path: `${title}.md`,
    title,
    date,
    type: "general",
    gist: null,
    tags: [],
    participants: [],
    startedAt: null,
    durationMs,
    signal: null,
  };
}

// A Wednesday.
const NOW = new Date(2026, 8, 23, 12, 0);

describe("signal", () => {
  it("reads the backend's blocks as heights", () => {
    expect(heights("▁█")).toEqual([1 / 8, 1]);
  });

  it("builds this week from Monday, marking today", () => {
    const week = thisWeek(
      [note("2026-09-21", 1), note("2026-09-23", 1), note("2026-09-23", 1)],
      NOW,
    );
    expect(week.map((d) => d.iso)).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
    expect(week.map((d) => d.count)).toEqual([1, 0, 2, 0, 0, 0, 0]);
    expect(week.find((d) => d.today)?.iso).toBe("2026-09-23");
  });

  it("counts only this week's meetings, and finds the longest", () => {
    const stats = weekStats(
      [
        note("2026-09-22", 30 * 60_000, "a"),
        note("2026-09-23", 58 * 60_000, "b"),
        note("2026-09-14", 99e6),
      ],
      NOW,
    );
    expect(stats.meetings).toBe(2);
    expect(stats.totalMs).toBe(88 * 60_000);
    expect(stats.longest?.title).toBe("b");
  });

  it("flicks back a week at a time, and knows how far there is to go", () => {
    const notes = [note("2026-09-15", 1), note("2026-09-02", 1)];
    expect(thisWeek(notes, NOW, 1).map((d) => d.iso)[0]).toBe("2026-09-14");
    expect(thisWeek(notes, NOW, 1).some((d) => d.today)).toBe(false);
    expect(weekStats(notes, NOW, 1).meetings).toBe(1);
    expect(weeksOnFile(notes, NOW)).toBe(3);
    expect(weeksOnFile([], NOW)).toBe(0);
  });

  it("numbers weeks as ISO 8601 does", () => {
    expect(isoWeek(NOW)).toBe(39);
    // 1 January 2027 is a Friday, so it belongs to 2026's last week.
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53);
    expect(isoWeek(new Date(2027, 0, 4))).toBe(1);
  });

  it("lays the year out a column a week, ending this week, with tomorrow blank", () => {
    const grid = yearGrid([note("2026-09-23", 1), note("2026-09-22", 1)], NOW);
    expect(grid).toHaveLength(53);
    const last = grid.at(-1);
    expect(last?.back).toBe(0);
    expect(last?.monday).toBe("2026-09-21");
    expect(last?.total).toBe(2);
    expect(last?.days.map((d) => d.future)).toEqual([false, false, false, true, true, true, true]);
    expect(grid.filter((w) => w.month !== null).length).toBeGreaterThanOrEqual(12);
  });

  it("counts a streak through a quiet weekend but not a quiet weekday", () => {
    // Thursday, Friday, Monday, Tuesday: four in a row. Then a gap.
    const notes = ["2026-09-10", "2026-09-11", "2026-09-14", "2026-09-15", "2026-09-17"].map((d) =>
      note(d, 1),
    );
    const stats = yearStats(yearGrid(notes, NOW));
    expect(stats.streak).toBe(4);
    expect(stats.days).toBe(5);
    expect(stats.meetings).toBe(5);
    expect(stats.busiest?.monday).toBe("2026-09-14");
    expect(heatLevel(9)).toBe(4);
  });

  it("says how long ago in words", () => {
    const now = NOW.getTime();
    expect(ago(now - 20_000, now)).toBe("just now");
    expect(ago(now - 12 * 60_000, now)).toBe("12 min ago");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(ago(now - 26 * 3_600_000, now)).toBe("yesterday");
  });

  it("marks every twenty-fifth meeting", () => {
    expect(milestone(50)).toBe(50);
    expect(milestone(51)).toBeNull();
    expect(milestone(0)).toBeNull();
  });
});
