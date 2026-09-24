import { describe, expect, it } from "vitest";
import type { NoteSummary } from "../../lib/ipc";
import {
  applyFilters,
  filterCount,
  lengthRange,
  parseQuery,
  searchText,
  setToken,
  tagCounts,
} from "./query";

const MIN = 60_000;

function note(title: string, extra: Partial<NoteSummary> = {}): NoteSummary {
  return {
    path: `${title}.md`,
    title,
    date: "2026-09-23",
    type: "general",
    gist: null,
    tags: [],
    startedAt: null,
    durationMs: null,
    signal: null,
    ...extra,
  };
}

describe("parseQuery", () => {
  it("separates filters from search terms", () => {
    const q = parseQuery("huspy tag:Interview len:>30m sort:oldest has:summary pricing");
    expect(q.terms).toEqual(["huspy", "pricing"]);
    expect(q.tags).toEqual(["interview"]);
    expect(q.length).toBe(">30m");
    expect(q.sort).toBe("oldest");
    expect(q.hasSummary).toBe(true);
  });

  it("searches for a filter-shaped word that is not a valid filter", () => {
    const q = parseQuery("sort:sideways len:forever http://x");
    expect(q.sort).toBeNull();
    expect(q.length).toBeNull();
    expect(q.terms).toEqual(["sort:sideways", "len:forever", "http://x"]);
  });

  it("sends only terms and tags to the backend", () => {
    expect(searchText(parseQuery("huspy tag:client len:<15m"))).toBe("huspy tag:client");
  });
});

describe("setToken", () => {
  it("replaces every word of a kind, at the end", () => {
    expect(setToken("tag:a huspy tag:b", "tag", "c")).toBe("huspy tag:c");
  });

  it("removes a kind for null", () => {
    expect(setToken("huspy sort:oldest", "sort", null)).toBe("huspy");
  });
});

describe("lengthRange", () => {
  it("reads under, over and between", () => {
    expect(lengthRange("<15m")).toEqual({ min: 0, max: 15 * MIN });
    expect(lengthRange(">1h")).toEqual({ min: 60 * MIN, max: Number.POSITIVE_INFINITY });
    expect(lengthRange("15m-60m")).toEqual({ min: 15 * MIN, max: 60 * MIN });
    expect(lengthRange("forever")).toBeNull();
  });
});

describe("applyFilters", () => {
  const notes = [
    note("short", { durationMs: 10 * MIN, tags: ["client"] }),
    note("long", { durationMs: 90 * MIN, gist: "we met", tags: ["client", "pricing"] }),
    note("unknown length", { durationMs: null }),
  ];

  it("keeps meetings carrying every tag asked for", () => {
    const titles = applyFilters(notes, parseQuery("tag:client tag:pricing")).map((n) => n.title);
    expect(titles).toEqual(["long"]);
  });

  it("filters by length and leaves out meetings with none recorded", () => {
    expect(applyFilters(notes, parseQuery("len:<15m")).map((n) => n.title)).toEqual(["short"]);
  });

  it("sorts longest first, with unknown lengths last", () => {
    expect(applyFilters(notes, parseQuery("sort:longest")).map((n) => n.title)).toEqual([
      "long",
      "short",
      "unknown length",
    ]);
  });

  it("counts filters, not terms or tags", () => {
    expect(filterCount(parseQuery("huspy tag:a len:<15m has:summary"))).toBe(2);
  });
});

describe("tagCounts", () => {
  it("orders by use, then name", () => {
    const counts = tagCounts([note("a", { tags: ["b", "a"] }), note("b", { tags: ["b"] })]);
    expect(counts).toEqual([
      { tag: "b", count: 2 },
      { tag: "a", count: 1 },
    ]);
  });
});
