import { afterEach, describe, expect, it } from "vitest";
import { CHANGELOG } from "../../changelog";
import { markWhatsNewSeen, unseenChanges } from "./changesSeen";

afterEach(() => {
  localStorage.clear();
  location.hash = "";
});

describe("what's new, seen or not", () => {
  it("offers only the newest before anything has been seen", () => {
    expect(unseenChanges().map((c) => c.version)).toEqual([CHANGELOG[0]?.version]);
  });

  it("offers only what came after the version last seen", () => {
    const previous = CHANGELOG[1]?.version ?? "";
    localStorage.setItem("trace.whats-new.seen", previous);
    expect(unseenChanges().map((c) => c.version)).toEqual([CHANGELOG[0]?.version]);
  });

  it("goes quiet once seen", () => {
    markWhatsNewSeen();
    expect(unseenChanges()).toEqual([]);
  });

  it("is not marked seen by the gallery, which shares the app's storage", () => {
    location.hash = "#gallery/about-whats-new";
    markWhatsNewSeen();
    expect(unseenChanges()).toHaveLength(1);
  });
});
