import { afterEach, describe, expect, it } from "vitest";
import {
  type Appearance,
  currentFilter,
  FAMILY_DEFAULTS,
  loadAppearance,
  saveAppearance,
  withFamily,
  withFilter,
  withTheme,
} from "./appearance";

afterEach(() => localStorage.clear());

function fresh(): Appearance {
  return {
    theme: "terminal",
    overrides: {},
    families: { retro: { ...FAMILY_DEFAULTS.retro }, modern: { ...FAMILY_DEFAULTS.modern } },
  };
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
});

describe("screen filters", () => {
  it("belong to the family, so flipping brings each one's back", () => {
    let a = withFilter(fresh(), "crt");
    expect(currentFilter(a)).toBe("crt");
    a = withFamily(a, "modern");
    expect(currentFilter(a)).toBe("none");
    a = withFamily(a, "retro");
    expect(currentFilter(a)).toBe("crt");
  });

  it("ignore a filter that does not exist", () => {
    const a = fresh();
    expect(withFilter(a, "bezel")).toBe(a);
  });
});

describe("storage", () => {
  it("carries CRT mode over into the crt filter, on the family it was used in", () => {
    localStorage.setItem("trace.theme", "graphite");
    localStorage.setItem("trace.appearance.crt", "on");
    const a = loadAppearance();
    expect(a.families.modern.filter).toBe("crt");
    expect(a.families.retro.filter).toBe(FAMILY_DEFAULTS.retro.filter);
  });

  it("forgets the CRT key once the new shape is saved", () => {
    localStorage.setItem("trace.appearance.crt", "on");
    saveAppearance(loadAppearance());
    expect(localStorage.getItem("trace.appearance.crt")).toBeNull();
    expect(currentFilter(loadAppearance())).toBe("crt");
  });

  it("drops a remembered theme that belongs to the other family", () => {
    localStorage.setItem(
      "trace.appearance.families",
      JSON.stringify({ modern: { filter: "glow", theme: "termcn" } }),
    );
    const a = loadAppearance();
    expect(a.families.modern).toEqual({ filter: "glow" });
  });
});
