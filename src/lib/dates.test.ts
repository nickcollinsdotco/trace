import { describe, expect, it } from "vitest";
import { groupByDate, groupForDate } from "./dates";

// Fixed reference point so these tests don't rot: Fri 4 Sep 2026, local noon.
const NOW = new Date(2026, 8, 4, 12, 0, 0);

describe("groupForDate", () => {
  it("labels the current day Today", () => {
    expect(groupForDate("2026-09-04", NOW)).toBe("Today");
  });

  it("labels the previous calendar day Yesterday", () => {
    expect(groupForDate("2026-09-03", NOW)).toBe("Yesterday");
  });

  it("groups 2-6 days back as This week", () => {
    expect(groupForDate("2026-09-02", NOW)).toBe("This week"); // 2 days
    expect(groupForDate("2026-08-29", NOW)).toBe("This week"); // 6 days — last day of the bucket
  });

  it("groups 7-30 days back as This month", () => {
    expect(groupForDate("2026-08-28", NOW)).toBe("This month"); // 7 days — first day of the bucket
    expect(groupForDate("2026-08-06", NOW)).toBe("This month"); // 29 days
  });

  it("groups anything older as Earlier", () => {
    expect(groupForDate("2026-08-04", NOW)).toBe("Earlier");
    expect(groupForDate("2019-01-01", NOW)).toBe("Earlier");
  });

  it("treats a future date as Today rather than falling through", () => {
    // Clock skew and timezone travel are real; a meeting must never vanish.
    expect(groupForDate("2026-09-05", NOW)).toBe("Today");
  });

  it("groups by calendar day, not by elapsed hours", () => {
    // 00:30 today vs 23:30 yesterday is one hour apart but two calendar days.
    const justAfterMidnight = new Date(2026, 8, 4, 0, 30, 0);
    expect(groupForDate("2026-09-03", justAfterMidnight)).toBe("Yesterday");
  });

  it("parses as local time, not UTC", () => {
    // `new Date("2026-09-04")` is UTC midnight, which is 3 Sep in the Americas.
    // Getting this wrong shifts every meeting a day for half the world.
    expect(groupForDate("2026-09-04", new Date(2026, 8, 4, 1, 0, 0))).toBe("Today");
  });

  it("degrades to Earlier on a malformed date rather than throwing", () => {
    expect(groupForDate("not-a-date", NOW)).toBe("Earlier");
    expect(groupForDate("", NOW)).toBe("Earlier");
  });
});

describe("groupByDate", () => {
  const item = (date: string, title: string) => ({ date, title });

  it("returns only non-empty groups, in display order", () => {
    const result = groupByDate(
      [item("2026-08-06", "old"), item("2026-09-04", "today")],
      (i) => i.date,
      NOW,
    );

    expect(result.map((g) => g.group)).toEqual(["Today", "This month"]);
  });

  it("sorts newest first within a group", () => {
    const result = groupByDate(
      [item("2026-08-30", "older"), item("2026-09-02", "newer")],
      (i) => i.date,
      NOW,
    );

    expect(result[0]?.items.map((i) => i.title)).toEqual(["newer", "older"]);
  });

  it("returns an empty array for no items", () => {
    expect(groupByDate([], (i: { date: string }) => i.date, NOW)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [item("2026-08-30", "a"), item("2026-09-02", "b")];
    const snapshot = [...input];
    groupByDate(input, (i) => i.date, NOW);
    expect(input).toEqual(snapshot);
  });
});
