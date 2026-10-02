import { describe, expect, it } from "vitest";
import { THEMES } from "../../design/theme";
import { secretFor } from "./Eggs";
import { freshEar, listen, narrate, segmentMilestone } from "./lines";

describe("the narrator's lines", () => {
  it("remarks on every step of the capitals ladder", () => {
    for (const step of ["none", "labels", "controls", "headings"]) {
      expect(narrate({ kind: "case", step })).toMatch(new RegExp(`^capitals: ${step}\\. `));
    }
    expect(narrate({ kind: "case", step: "headings" })).toContain("shouting enabled");
  });

  it("has a line of its own for every theme, and a plain one for anything else", () => {
    const lines = THEMES.map((theme) => narrate({ kind: "theme", theme }));
    for (const [i, line] of lines.entries())
      expect(line).toMatch(new RegExp(`^theme: ${THEMES[i]}\\. `));
    expect(new Set(lines).size).toBe(THEMES.length);
    expect(narrate({ kind: "theme", theme: "custom" })).toBe(
      "theme: custom. same words, different light.",
    );
  });

  it("remarks on a meeting started after midnight", () => {
    expect(narrate({ kind: "started", hour: 1 })).toMatch(/midnight oil/);
    expect(narrate({ kind: "started", hour: 14 })).not.toMatch(/midnight/);
  });

  it("states a stopped meeting in counts", () => {
    expect(narrate({ kind: "stopped", elapsedMs: 42 * 60_000, segments: 318 })).toBe(
      "saved. 42 min, 318 segments. writing notes.",
    );
  });

  it("never claims the microphone is open while idle", () => {
    for (let tick = 0; tick < 10; tick++) {
      expect(narrate({ kind: "idle", notes: 6, tick })).not.toMatch(/listening/);
    }
  });

  it("speaks every hundredth segment, once", () => {
    expect(segmentMilestone(98, 101)).toBe(100);
    expect(segmentMilestone(101, 140)).toBeNull();
    expect(segmentMilestone(0, 5)).toBeNull();
  });
});

describe("listening to the levels", () => {
  it("hears crosstalk after three seconds of both channels, and rests after", () => {
    let ear = freshEar();
    const heard: Array<string | null> = [];
    for (let s = 0; s < 6; s++) {
      const r = listen(ear, 0.08, 0.06, s * 1000);
      ear = r.ear;
      heard.push(r.heard);
    }
    expect(heard.filter((h) => h === "crosstalk")).toHaveLength(1);
    expect(heard[2]).toBe("crosstalk");
  });

  it("does not call one voice crosstalk", () => {
    let ear = freshEar();
    for (let s = 0; s < 10; s++) {
      const r = listen(ear, 0.08, 0.001, s * 1000);
      ear = r.ear;
      expect(r.heard).toBeNull();
    }
  });

  it("notices thirty seconds of quiet once, until someone speaks again", () => {
    let ear = freshEar();
    const quiet: number[] = [];
    for (let s = 0; s <= 80; s++) {
      // Someone speaks at 40s, so the quiet can be noticed a second time.
      const level = s === 40 ? 0.05 : 0.001;
      const r = listen(ear, level, 0.001, s * 1000);
      ear = r.ear;
      if (r.heard === "quiet") quiet.push(s);
    }
    // Quiet again from 41s, so 30 seconds later is 71s.
    expect(quiet).toEqual([30, 71]);
  });
});

describe("keyboard secrets", () => {
  const keys = (s: string) => [...s];

  it("finds the Konami code", () => {
    const konami = [
      "ArrowUp",
      "ArrowUp",
      "ArrowDown",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ArrowLeft",
      "ArrowRight",
      "B",
      "a",
    ];
    expect(secretFor(konami)).toBe("konami");
    expect(secretFor(konami.slice(1))).toBeNull();
  });

  it("finds trace typed outside a field, in any case", () => {
    expect(secretFor(keys("xxTRACE"))).toBe("trace");
    expect(secretFor(keys("trac"))).toBeNull();
  });
});
