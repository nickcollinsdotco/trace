import { afterEach, describe, expect, it } from "vitest";
import {
  type Appearance,
  currentAdjustments,
  currentScreen,
  defaultFamilies,
  isAdjusted,
  loadAppearance,
  saveAppearance,
  withAxis,
  withEffect,
  withFamily,
  withPreset,
  withReset,
  withTheme,
} from "./appearance";
import { presetOf, presetScreen } from "./screen";

afterEach(() => localStorage.clear());

function fresh(): Appearance {
  return { theme: "carbon", adjustments: {}, families: defaultFamilies() };
}

/** A look on the Retro side; the default, Carbon, is Modern. */
function retro(): Appearance {
  return withTheme(fresh(), "shell");
}

describe("families", () => {
  it("come back to the theme last used in them, not their first", () => {
    let a = withTheme(fresh(), "graphite");
    a = withTheme(a, "industrial");
    a = withFamily(a, "modern");
    expect(a.theme).toBe("graphite");
    a = withFamily(a, "retro");
    expect(a.theme).toBe("industrial");
  });

  it("do nothing when asked for the family already in use", () => {
    const a = withTheme(fresh(), "report");
    expect(withFamily(a, "retro")).toBe(a);
  });

  it("start Retro on soft lines and Modern on clean glass", () => {
    expect(presetOf(currentScreen(fresh()))).toBe("none");
    expect(presetOf(currentScreen(retro()))).toBe("lines");
  });
});

describe("screens", () => {
  it("belong to the family, so flipping brings each one's back", () => {
    let a = withPreset(retro(), "crt");
    a = withFamily(a, "modern");
    expect(presetOf(currentScreen(a))).toBe("none");
    a = withFamily(a, "retro");
    expect(presetOf(currentScreen(a))).toBe("crt");
  });

  it("keep a hand-set effect on its own family only", () => {
    let a = withEffect(retro(), "grain", { amount: 70, place: "behind" });
    expect(currentScreen(a).grain).toEqual({ amount: 70, place: "behind", size: 1 });
    a = withFamily(a, "modern");
    expect(currentScreen(a).grain.amount).toBe(0);
  });
});

describe("adjustments", () => {
  it("belong to the theme they were made on", () => {
    let a = withAxis(fresh(), "mono", "plex");
    expect(isAdjusted(a, "carbon")).toBe(true);
    a = withTheme(a, "industrial");
    expect(currentAdjustments(a)).toEqual({});
    a = withTheme(a, "carbon");
    expect(currentAdjustments(a).mono).toBe("plex");
  });

  it("reset only the current theme", () => {
    let a = withAxis(fresh(), "mono", "plex");
    a = withAxis(withTheme(a, "report"), "case", "none");
    a = withReset(a);
    expect(isAdjusted(a, "report")).toBe(false);
    expect(isAdjusted(a, "carbon")).toBe(true);
  });

  it("carry the old global overrides onto the theme in use, and only it", () => {
    localStorage.setItem("trace.theme", "termcn");
    localStorage.setItem("trace.appearance.overrides", JSON.stringify({ frame: "box" }));
    const a = loadAppearance();
    expect(a.adjustments).toEqual({ termcn: { frame: "box" } });
    saveAppearance(a);
    expect(localStorage.getItem("trace.appearance.overrides")).toBeNull();
    expect(loadAppearance().adjustments.termcn?.frame).toBe("box");
  });

  it("carry nothing over when nothing was set", () => {
    localStorage.setItem("trace.appearance.overrides", JSON.stringify({ frame: "rhombus" }));
    expect(loadAppearance().adjustments).toEqual({});
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

  it("moves a screen saved before 0.27 behind, once, and then leaves it be", () => {
    const old = presetScreen("crt");
    old.scanlines.place = "over";
    old.glass.place = "over";
    localStorage.setItem("trace.appearance.families", JSON.stringify({ retro: { screen: old } }));
    let a = loadAppearance();
    expect(a.families.retro.screen.scanlines.place).toBe("behind");
    expect(a.families.retro.screen.glass.place).toBe("behind");
    expect(presetOf(a.families.retro.screen)).toBe("crt");

    // Put back over on purpose: that sticks.
    a = withEffect(withTheme(a, "shell"), "scanlines", { place: "over" });
    saveAppearance(a);
    expect(loadAppearance().families.retro.screen.scanlines.place).toBe("over");
  });

  it("round-trips a mixed screen", () => {
    const a = withEffect(withPreset(fresh(), "lofi"), "dots", { amount: 35 });
    saveAppearance(a);
    expect(currentScreen(loadAppearance())).toEqual(currentScreen(a));
    expect(localStorage.getItem("trace.appearance.crt")).toBeNull();
  });

  it("lets a retired theme go quietly: default theme, adjustments dropped", () => {
    localStorage.setItem("trace.theme", "console");
    localStorage.setItem(
      "trace.appearance.adjustments",
      JSON.stringify({ council: { frame: "card" }, report: { case: "lower" } }),
    );
    localStorage.setItem(
      "trace.appearance.families",
      JSON.stringify({ retro: { theme: "council" } }),
    );
    const a = loadAppearance();
    expect(a.theme).toBe("carbon");
    // Kept, and read on the ladder: lower case became "none".
    expect(a.adjustments).toEqual({ report: { case: "none" } });
    expect(a.families.retro.theme).toBeUndefined();
  });

  it("reads terminal, Carbon's old name, as Carbon — the theme and its adjustments", () => {
    localStorage.setItem("trace.theme", "terminal");
    localStorage.setItem(
      "trace.appearance.adjustments",
      JSON.stringify({ terminal: { mono: "plex" } }),
    );
    const a = loadAppearance();
    expect(a.theme).toBe("carbon");
    expect(a.adjustments).toEqual({ carbon: { mono: "plex" } });
  });

  it("drops a remembered theme that belongs to the other family", () => {
    localStorage.setItem(
      "trace.appearance.families",
      JSON.stringify({ modern: { theme: "termcn" } }),
    );
    expect(loadAppearance().families.modern.theme).toBeUndefined();
  });
});
