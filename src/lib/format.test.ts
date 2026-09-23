import { describe, expect, it } from "vitest";
import { formatMeetingLength } from "./format";

describe("formatMeetingLength", () => {
  it("rounds to the minute", () => {
    expect(formatMeetingLength(47 * 60_000 + 12_000)).toBe("47 min");
    expect(formatMeetingLength(29_000)).toBe("<1 min");
  });

  it("switches to hours past sixty minutes", () => {
    expect(formatMeetingLength(94 * 60_000)).toBe("1h 34m");
    expect(formatMeetingLength(120 * 60_000)).toBe("2h 00m");
  });
});
