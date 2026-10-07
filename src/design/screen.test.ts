import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyScreen,
  EFFECTS,
  PRESETS,
  presetOf,
  presetScreen,
  readScreen,
  withEffectSetting,
} from "./screen";

describe("presets", () => {
  it("are each recognised as themselves", () => {
    for (const p of PRESETS) expect(presetOf(presetScreen(p))).toBe(p);
  });

  it("stop being a preset once anything is moved", () => {
    const moved = withEffectSetting(presetScreen("lofi"), "glow", { amount: 65 });
    expect(presetOf(moved)).toBeNull();
  });

  it("ignore where an effect that is off would sit", () => {
    const moved = withEffectSetting(presetScreen("lofi"), "grain", { place: "behind" });
    expect(presetOf(moved)).toBe("lofi");
  });
});

describe("effects", () => {
  it("clamp their amount", () => {
    expect(withEffectSetting(presetScreen("none"), "grain", { amount: 140 }).grain.amount).toBe(
      100,
    );
    expect(withEffectSetting(presetScreen("none"), "grain", { amount: -5 }).grain.amount).toBe(0);
  });

  it("start behind the letters wherever they can go", () => {
    const s = presetScreen("crt");
    expect(s.scanlines.place).toBe("behind");
    expect(s.glass.place).toBe("behind");
    expect(s.roll.place).toBe("behind");
    expect(s.vignette.place).toBe("over");
    expect(s.glow.place).toBe("over");
  });

  it("cannot put a vignette behind the letters, which it could only darken", () => {
    const s = withEffectSetting(presetScreen("none"), "vignette", { amount: 50, place: "behind" });
    expect(s.vignette.place).toBe("over");
  });

  it("read back each effect on its own, so one bad value costs only that one", () => {
    const s = readScreen(
      {
        grain: { amount: 30, place: "behind" },
        glow: { amount: "loud" },
        dots: { place: "under" },
      },
      presetScreen("grid"),
    );
    expect(s.grain).toEqual({ amount: 30, place: "behind", size: 1 });
    expect(s.glow.amount).toBe(0);
    expect(s.dots).toEqual(presetScreen("grid").dots);
  });
});

describe("sizes", () => {
  it("default to the middle of the range and are kept by presets", () => {
    const s = presetScreen("lines");
    expect(s.scanlines.size).toBe(3);
    expect(presetOf(withEffectSetting(s, "scanlines", { size: 6 }))).toBeNull();
  });

  it("refuse a size the effect does not come in", () => {
    const s = withEffectSetting(presetScreen("grid"), "dots", { size: 7 });
    expect(s.dots.size).toBe(8);
    expect(readScreen({ dots: { amount: 60, size: 99 } }, presetScreen("grid")).dots.size).toBe(8);
  });
});

describe("applyScreen", () => {
  it("draws only the effects that are on, and names the preset", () => {
    const el = document.createElement("div");
    applyScreen(presetScreen("film"), el);
    expect(el.getAttribute("data-fx-grain")).toBe("behind");
    expect(el.style.getPropertyValue("--fx-grain")).toBe("0.45");
    expect(el.hasAttribute("data-fx-scanlines")).toBe(false);
    expect(el.getAttribute("data-screen-preset")).toBe("film");
    expect(el.style.getPropertyValue("--fx-grain-size")).toBe("1");
    expect(el.hasAttribute("data-fx-behind")).toBe(true);

    applyScreen(presetScreen("none"), el);
    expect(el.hasAttribute("data-fx-behind")).toBe(false);
    for (const e of EFFECTS) expect(el.hasAttribute(`data-fx-${e}`)).toBe(false);
    expect(el.hasAttribute("data-screen-preset")).toBe(false);
  });
});

/*
 * Source-level guards, as in type.test.ts: jsdom cannot composite a blend,
 * so these assert the rules the effects' legibility rests on still exist.
 */
const css = readFileSync(join(process.cwd(), "src/design/screen.css"), "utf8");

describe("screen.css", () => {
  it("shades with overlay rather than painting lines over the letters", () => {
    expect(css).toMatch(/\.trace-fx-scanlines\s*\{[^}]*mix-blend-mode:\s*overlay/);
  });

  it("puts textures behind by layering them under the content", () => {
    // Under, not blended over: a blend over everything still covered every
    // dark card, and "behind" looked the same as "over".
    const under = css.match(/([^{}]*)\{\s*z-index:\s*-1;\s*\}/)?.[1] ?? "";
    for (const e of ["grain", "scanlines", "dots"]) {
      expect(under).toContain(`[data-fx-${e}="behind"] .trace-fx-${e}`);
    }
  });

  it("fills boxes and fields while something is behind, so it stops at their edge", () => {
    expect(css).toMatch(/\[data-fx-behind\]\[data-frame="box"\] \.trace-section/);
    expect(css).toMatch(/\[data-fx-behind\] \.trace-field:not\(select\)/);
  });

  it("never animates grain by moving a picture of it", () => {
    // The rejected grain slid one noise image about with keyframes. Grain is
    // drawn afresh each frame by Grain.tsx; CSS only says how it blends.
    const rules = css.match(/\.trace-fx-grain\s*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).not.toMatch(/animation|transform|background/);
  });

  it("draws on the canvas only, never over the sidebar", () => {
    expect(css).toMatch(/\.trace-canvas\s*\{[^}]*isolation:\s*isolate/);
    expect(css).not.toMatch(/\.trace-screen/);
  });
});
