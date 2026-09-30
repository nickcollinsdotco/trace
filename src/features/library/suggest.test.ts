import { describe, expect, it } from "vitest";
import type { NoteSummary } from "../../lib/ipc";
import { applyFilters, parseQuery, peopleCounts, personSlug } from "./query";
import { applySuggestion, suggest, wordAt } from "./suggest";

function note(title: string, extra: Partial<NoteSummary> = {}): NoteSummary {
  return {
    path: `${title}.md`,
    title,
    date: "2026-09-23",
    type: "general",
    gist: null,
    tags: [],
    participants: [],
    startedAt: null,
    durationMs: null,
    signal: null,
    ...extra,
  };
}

const LIBRARY = [
  note("Pricing", { tags: ["client", "pricing"], participants: ["Sarah Chen", "Dev"] }),
  note("Planning", { tags: ["planning"], participants: ["Sarah Chen", "Priya Raman"] }),
  note("Vendor", { tags: ["client"], participants: ["priya raman"], type: "client" }),
];

const values = (q: string, caret = q.length) => suggest(q, caret, LIBRARY).map((s) => s.value);

describe("wordAt", () => {
  it("finds the word around the cursor, not the last one", () => {
    expect(wordAt("tag:cl pricing", 3).text).toBe("tag:cl");
    expect(wordAt("tag:cl pricing", 14).text).toBe("pricing");
    expect(wordAt("tag:cl ", 7).text).toBe("");
  });
});

describe("suggest", () => {
  it("says what can be typed on an empty line, and nothing between words", () => {
    expect(values("")).toContain("with:");
    expect(values("pricing ")).toEqual([]);
  });

  it("offers the people, tags and filters a bare word could start", () => {
    expect(values("sa")).toEqual(["with:sarah-chen"]);
    expect(values("pr")).toEqual(["with:priya-raman", "tag:pricing"]);
    expect(values("wi")).toEqual(["with:"]);
  });

  it("finds someone by any part of their name", () => {
    expect(values("chen")).toEqual(["with:sarah-chen"]);
  });

  it("offers a filter's values once its name is typed", () => {
    // Most used first, then alphabetical: tagCounts's order.
    expect(values("tag:")).toEqual(["tag:client", "tag:planning", "tag:pricing"]);
    expect(values("with:pri")).toEqual(["with:priya-raman"]);
    expect(values("len:")).toEqual(["len:<15m", "len:15m-60m", "len:>60m"]);
    expect(values("type:")).toEqual(["type:client"]);
  });

  it("never offers exactly what is already typed", () => {
    expect(values("tag:client")).toEqual([]);
  });

  it("counts a person once per meeting, however their name was spelt", () => {
    expect(peopleCounts(LIBRARY)).toEqual([
      { name: "Priya Raman", count: 2 },
      { name: "Sarah Chen", count: 2 },
      { name: "Dev", count: 1 },
    ]);
  });
});

describe("applySuggestion", () => {
  it("replaces the word at the cursor and leaves room for the next", () => {
    expect(applySuggestion("fix sa", 6, "with:sarah-chen")).toEqual({
      query: "fix with:sarah-chen ",
      caret: 20,
    });
  });

  it("leaves a filter's name open for its value", () => {
    expect(applySuggestion("ta", 2, "tag:")).toEqual({ query: "tag:", caret: 4 });
  });

  it("completes a word in the middle without doubling the space after it", () => {
    expect(applySuggestion("tag:cl pricing", 3, "tag:client")).toEqual({
      query: "tag:client pricing",
      caret: 10,
    });
  });
});

describe("with:", () => {
  it("keeps the meetings someone was in, by any part of their name", () => {
    const kept = (q: string) => applyFilters(LIBRARY, parseQuery(q)).map((n) => n.title);
    expect(kept("with:sarah")).toEqual(["Pricing", "Planning"]);
    expect(kept("with:priya-raman")).toEqual(["Planning", "Vendor"]);
    expect(kept("with:sarah with:dev")).toEqual(["Pricing"]);
  });

  it("ignores a filter name still waiting for its value", () => {
    // Searched for, "tag:" found nothing and emptied the list behind the
    // very suggestions offering its values.
    expect(parseQuery("tag: budget").terms).toEqual(["budget"]);
    expect(applyFilters(LIBRARY, parseQuery("with:"))).toHaveLength(3);
  });

  it("is not sent to the full-text search as a term", () => {
    expect(parseQuery("with:sarah budget").terms).toEqual(["budget"]);
    expect(personSlug("  Sarah   Chen ")).toBe("sarah-chen");
  });
});
