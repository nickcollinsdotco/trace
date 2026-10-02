import { describe, expect, it } from "vitest";
import { fitTags } from "./fit";

const BAR = { gap: 4, more: 40 };

describe("fitTags", () => {
  it("shows every tag when they all fit", () => {
    expect(fitTags([50, 50, 50], { ...BAR, space: 162 })).toEqual([0, 1, 2]);
  });

  it("keeps room for the overflow button", () => {
    // Two would fit on their own (108), but not with "+1 more" beside them.
    expect(fitTags([50, 50, 50], { ...BAR, space: 140 })).toEqual([0]);
  });

  it("stops at the first that does not fit, keeping the order", () => {
    expect(fitTags([30, 90, 10], { ...BAR, space: 100 })).toEqual([0]);
  });

  it("always shows the tag asked for, last", () => {
    expect(fitTags([50, 50, 50, 50], { ...BAR, space: 160 }, 3)).toEqual([0, 3]);
  });

  it("shows only the overflow when nothing fits", () => {
    expect(fitTags([80, 80], { ...BAR, space: 60 })).toEqual([]);
  });
});
