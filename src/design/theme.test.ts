import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, isTheme, loadTheme, saveTheme, THEME_NOTES, THEMES } from "./theme";

describe("themes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("treats terminal as the absence of overrides", () => {
    // The default lives in `@theme` on :root. If selecting it set an
    // attribute instead of clearing one, "terminal must stay pixel-identical"
    // would depend on a second copy of every token staying in sync.
    const el = document.createElement("div");
    el.setAttribute("data-theme", "futurist");

    applyTheme("terminal", el);

    expect(el.hasAttribute("data-theme")).toBe(false);
  });

  it("applies other themes as an attribute", () => {
    const el = document.createElement("div");
    applyTheme("quiet", el);
    expect(el.getAttribute("data-theme")).toBe("quiet");
  });

  it("round-trips a saved choice", () => {
    saveTheme("futurist");
    expect(loadTheme()).toBe("futurist");
  });

  it("falls back to terminal for junk in storage", () => {
    localStorage.setItem("trace.theme", "neon-hellscape");
    expect(loadTheme()).toBe("terminal");
  });

  it("describes every theme", () => {
    // The switcher shows these as tooltips; a missing one is a blank hint.
    for (const t of THEMES) {
      expect(THEME_NOTES[t]).toBeTruthy();
    }
  });

  it("rejects non-themes", () => {
    expect(isTheme("terminal")).toBe(true);
    expect(isTheme("Terminal")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});
