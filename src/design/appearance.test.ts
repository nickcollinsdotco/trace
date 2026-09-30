import { afterEach, describe, expect, it } from "vitest";
import {
  type Appearance,
  currentScreen,
  defaultFamilies,
  loadAppearance,
  saveAppearance,
  withEffect,
  withFamily,
  withPreset,
  withTheme,
} from "./appearance";
import { presetOf } from "./screen";

afterEach(() => localStorage.clear());

function fresh(): Appearance {
  return { theme: "terminal", overrides: {}, families: defaultFamilies() };
}

describe("families", () => {
  it("come back to the theme last used in them, not their first", () => {
    let a = withTheme(fresh(), "industrial");
    a = withFamily(a, "modern");
    expect(a.theme).toBe("graphite");
    a = withFamily(a, "retro");
    expect(a.theme).toBe("industrial");
  });

  it("do nothing when asked for the family already in use", () => {
    const a = withTheme(fresh(), "console");
    expect(withFamily(a, "retro")).toBe(a);
  });

  it("start Retro on soft lines and Modern on clean glass", () => {
    const a = fresh();
    expect(presetOf(currentScreen(a))).toBe("lines");
    expect(presetOf(currentScreen(withFamily(a, "modern")))).toBe("none");
  });
});

describe("screens", () => {
  it("belong to the family, so flipping brings each one's back", () => {
    let a = withPreset(fresh(), "crt");
    a = withFamily(a, "modern");
    expect(presetOf(currentScreen(a))).toBe("none");
    a = withFamily(a, "retro");
    expect(presetOf(currentScreen(a))).toBe("crt");
  });

  it("keep a hand-set effect on its own family only", () => {
    let a = withEffect(fresh(), "grain", { amount: 70, place: "behind" });
    expect(currentScreen(a).grain).toEqual({ amount: 70, place: "behind" });
    a = withFamily(a, "modern");
    expect(currentScreen(a).grain.amount).toBe(0);
  });
});

describe("storage", () => {
  it("carries CRT mode over into the crt preset, on the family it was used in", () => {
    localStorage.setItem("trace.theme", "graphite");
    localStorage.setItem("trace.appearance.crt", "on");
    const a = loadAppearance();
    expect(presetOf(a.families.modern.screen)).toBe("crt");
    expect(presetOf(a.families.retro.screen)).toBe("lines");
  });

  it("carries a 0.7 single filter over to the nearest preset", () => {
    localStorage.setItem(
      "trace.appearance.families",
      JSON.stringify({ retro: { filter: "vhs", strength: "strong" } }),
    );
    expect(presetOf(loadAppearance().families.retro.screen)).toBe("film");
  });

  it("round-trips a mixed screen", () => {
    const a = withEffect(withPreset(fresh(), "lofi"), "dots", { amount: 35 });
    saveAppearance(a);
    expect(currentScreen(loadAppearance())).toEqual(currentScreen(a));
    expect(localStorage.getItem("trace.appearance.crt")).toBeNull();
  });

  it("drops a remembered theme that belongs to the other family", () => {
    localStorage.setItem(
      "trace.appearance.families",
      JSON.stringify({ modern: { theme: "termcn" } }),
    );
    expect(loadAppearance().families.modern.theme).toBeUndefined();
  });
});
