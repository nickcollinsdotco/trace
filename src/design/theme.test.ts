import { beforeEach, describe, expect, it } from "vitest";
import {
  applyTheme,
  CASE_NOTES,
  isLetterCase,
  isMono,
  isTheme,
  isTypeRole,
  loadTheme,
  MONO_NOTES,
  MONOS,
  saveTheme,
  THEME_FRAME,
  THEME_NOTES,
  THEME_TYPE,
  THEMES,
  TYPE_NOTES,
  TYPES,
} from "./theme";

describe("themes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("treats terminal as the absence of overrides", () => {
    // The default lives in `@theme` on :root. If selecting it set an
    // attribute instead of clearing one, "terminal must stay pixel-identical"
    // would depend on a second copy of every token staying in sync.
    const el = document.createElement("div");
    el.setAttribute("data-theme", "report");

    applyTheme("terminal", el);

    expect(el.hasAttribute("data-theme")).toBe(false);
  });

  it("applies other themes as an attribute", () => {
    const el = document.createElement("div");
    applyTheme("report", el);
    expect(el.getAttribute("data-theme")).toBe("report");
  });

  it("round-trips a saved choice", () => {
    saveTheme("industrial");
    expect(loadTheme()).toBe("industrial");
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

  it("sets each theme's own framing", () => {
    const el = document.createElement("div");

    applyTheme("report", el);
    expect(el.getAttribute("data-frame")).toBe("box");

    applyTheme("console", el);
    expect(el.getAttribute("data-frame")).toBe("rule");
  });

  it("lets framing be overridden independently of the palette", () => {
    // The whole point of the gallery's Frame switch: ask "what does terminal
    // look like boxed?" without inventing a fourth theme to find out.
    const el = document.createElement("div");
    applyTheme("terminal", el, { frame: "box" });

    expect(el.hasAttribute("data-theme")).toBe(false);
    expect(el.getAttribute("data-frame")).toBe("box");
  });

  it("declares a framing for every theme", () => {
    for (const t of THEMES) {
      expect(THEME_FRAME[t], t).toBeTruthy();
    }
  });

  it("sets each theme's own typeface pairing", () => {
    const el = document.createElement("div");

    applyTheme("report", el);
    expect(el.getAttribute("data-mono")).toBe("plex");
    expect(el.getAttribute("data-type")).toBe("mono");

    applyTheme("terminal", el);
    expect(el.getAttribute("data-type")).toBe("hybrid");
  });

  it("varies one type axis without disturbing the others", () => {
    // The point of the gallery's Type and Mono switchers: answer "does report
    // survive a proportional body?" without editing the theme to find out.
    const el = document.createElement("div");
    applyTheme("report", el, { role: "sans" });

    expect(el.getAttribute("data-type")).toBe("sans");
    // Still the theme's own mono and framing.
    expect(el.getAttribute("data-mono")).toBe("plex");
    expect(el.getAttribute("data-frame")).toBe("box");
  });

  it("declares and describes a pairing for every theme", () => {
    for (const t of THEMES) {
      expect(THEME_TYPE[t], t).toBeTruthy();
      expect(MONO_NOTES[THEME_TYPE[t].mono], t).toBeTruthy();
      expect(TYPE_NOTES[THEME_TYPE[t].role], t).toBeTruthy();
      expect(CASE_NOTES[THEME_TYPE[t].case], t).toBeTruthy();
    }
    for (const m of MONOS) expect(MONO_NOTES[m], m).toBeTruthy();
    for (const r of TYPES) expect(TYPE_NOTES[r], r).toBeTruthy();
  });

  it("sets each theme's letter case, and normal is inert", () => {
    const el = document.createElement("div");

    applyTheme("report", el);
    expect(el.getAttribute("data-case")).toBe("upper");

    applyTheme("console", el);
    expect(el.getAttribute("data-case")).toBe("lower");

    // terminal must stay exactly as it is: "normal" has no CSS rules at all,
    // so the theme's own label casing still decides.
    applyTheme("terminal", el);
    expect(el.getAttribute("data-case")).toBe("normal");
  });

  it("overrides case without disturbing the other axes", () => {
    const el = document.createElement("div");
    applyTheme("industrial", el, { case: "lower" });

    expect(el.getAttribute("data-case")).toBe("lower");
    expect(el.getAttribute("data-mono")).toBe("fragment");
    expect(el.getAttribute("data-frame")).toBe("box");
  });

  it("rejects non-fonts", () => {
    expect(isMono("plex")).toBe(true);
    expect(isMono("comic-sans")).toBe(false);
    expect(isTypeRole("mono")).toBe(true);
    expect(isTypeRole("Mono")).toBe(false);
    expect(isLetterCase("upper")).toBe(true);
    expect(isLetterCase("UPPER")).toBe(false);
  });

  it("rejects non-themes", () => {
    expect(isTheme("terminal")).toBe(true);
    expect(isTheme("Terminal")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});
