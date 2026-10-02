import { describe, expect, it } from "vitest";
import { CHANGELOG, type Change, changesSince, freshness } from "./changelog";
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
    expect(f.get("a")).toEqual({ tier: "new", version: "0.2.1", what: "moved", read: false });
    expect(f.get("b")?.tier).toBe("new");
    expect(f.get("c")?.tier).toBe("recent");
    expect(f.has("d")).toBe(false);
  });

  it("keeps the badge once looked at, read, until it changes again", () => {
    expect(freshness(log, { a: "0.3.0" }).get("a")).toMatchObject({ tier: "new", read: true });
    // Looked at before its latest change: unread again.
    expect(freshness(log, { a: "0.2.0" }).get("a")?.read).toBe(false);
  });

  it("finds what is new since a version, or only the newest before any was seen", () => {
    expect(changesSince(log, "0.2.0").map((c) => c.version)).toEqual(["0.3.0", "0.2.1"]);
    expect(changesSince(log, null).map((c) => c.version)).toEqual(["0.3.0"]);
    expect(changesSince(log, "0.3.0")).toEqual([]);
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
