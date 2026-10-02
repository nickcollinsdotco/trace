import { describe, expect, it } from "vitest";
import { CHANGELOG, type Change, freshness } from "./changelog";
import { SCENARIOS } from "./fixtures/scenarios";

const log: Change[] = [
  { version: "0.3.0", date: "", title: "", notes: [] },
  { version: "0.2.1", date: "", title: "", notes: [], screens: { a: "moved", b: "new" } },
  { version: "0.2.0", date: "", title: "", notes: [], screens: { a: "first", c: "added" } },
  { version: "0.1.0", date: "", title: "", notes: [], screens: { d: "old news" } },
];

describe("what the gallery points at", () => {
  it("calls the latest version that changed screens new, and the one before recent", () => {
    // 0.3.0 changed nothing on screen, so it does not push 0.2.1 out.
    const f = freshness(log);
    expect(f.get("a")).toEqual({ tier: "new", version: "0.2.1", what: "moved" });
    expect(f.get("b")?.tier).toBe("new");
    expect(f.get("c")?.tier).toBe("recent");
    expect(f.has("d")).toBe(false);
  });

  it("forgets a change once it has been looked at, until it changes again", () => {
    expect(freshness(log, { a: "0.3.0" }).has("a")).toBe(false);
    // Looked at before its latest change: still new.
    expect(freshness(log, { a: "0.2.0" }).get("a")?.tier).toBe("new");
  });

  it("names only scenarios that exist", () => {
    const ids = new Set(SCENARIOS.map((s) => s.id));
    for (const change of CHANGELOG) {
      for (const id of Object.keys(change.screens ?? {})) {
        expect(ids.has(id), `${change.version} names ${id}`).toBe(true);
      }
    }
  });
});
