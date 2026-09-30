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
    expect(s.grain).toEqual({ amount: 30, place: "behind" });
    expect(s.glow.amount).toBe(0);
    expect(s.dots).toEqual(presetScreen("grid").dots);
  });
});

describe("applyScreen", () => {
  it("draws only the effects that are on, and names the preset", () => {
    const el = document.createElement("div");
    applyScreen(presetScreen("film"), el);
    expect(el.getAttribute("data-fx-grain")).toBe("over");
    expect(el.style.getPropertyValue("--fx-grain")).toBe("0.45");
    expect(el.hasAttribute("data-fx-scanlines")).toBe(false);
    expect(el.getAttribute("data-screen-preset")).toBe("film");

    applyScreen(presetScreen("none"), el);
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

  it("puts textures behind the letters by blending to lighten", () => {
    for (const e of ["grain", "scanlines", "dots"]) {
      expect(css).toMatch(
        new RegExp(
          `\\[data-fx-${e}="behind"\\] \\.trace-fx-${e}\\s*\\{[^}]*mix-blend-mode:\\s*lighten`,
        ),
      );
    }
  });

  it("draws on the canvas only, never over the sidebar", () => {
    expect(css).toMatch(/\.trace-canvas\s*\{[^}]*isolation:\s*isolate/);
    expect(css).not.toMatch(/\.trace-screen/);
  });
});
