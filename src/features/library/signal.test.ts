import { describe, expect, it } from "vitest";
import type { NoteSummary } from "../../lib/ipc";
import { ago, heights, milestone, thisWeek, weekStats } from "./signal";

function note(date: string, durationMs: number | null, title = date): NoteSummary {
  return {
    path: `${title}.md`,
    title,
    date,
    type: "general",
    gist: null,
    tags: [],
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
