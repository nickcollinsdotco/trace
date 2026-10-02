import { beforeEach, describe, expect, it } from "vitest";
import {
  applyTheme,
  CASE_NOTES,
  isLetterCase,
  isMono,
  isTheme,
  isTypeRole,
  letterCase,
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
  themeForKey,
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

    applyTheme("carbon", el);

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
    expect(loadTheme()).toBe("carbon");
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

    applyTheme("index", el);
    expect(el.getAttribute("data-frame")).toBe("rule");
  });

  it("lets framing be overridden independently of the palette", () => {
    // The whole point of the gallery's Frame switch: ask "what does terminal
    // look like boxed?" without inventing a fourth theme to find out.
    const el = document.createElement("div");
    applyTheme("carbon", el, { frame: "box" });

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

    applyTheme("carbon", el);
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

  it("sets each theme's step on the capitals ladder, and an adjustment overrides it", () => {
    const el = document.createElement("div");

    applyTheme("report", el);
    expect(el.getAttribute("data-case")).toBe("headings");
    applyTheme("carbon", el);
    expect(el.getAttribute("data-case")).toBe("labels");
    applyTheme("graphite", el);
    expect(el.getAttribute("data-case")).toBe("none");

    applyTheme("report", el, { case: "none" });
    expect(el.getAttribute("data-case")).toBe("none");
  });

  it("flaps the letters when capitals move on the same theme, not when the theme changes", () => {
    const el = document.createElement("div");
    applyTheme("report", el);
    applyTheme("carbon", el);
    // A new theme with another default step: a new look, no flap.
    expect(el.hasAttribute("data-case-flap")).toBe(false);
    applyTheme("carbon", el, { case: "headings" });
    expect(el.hasAttribute("data-case-flap")).toBe(true);
  });

  it("overrides case without disturbing the other axes", () => {
    const el = document.createElement("div");
    applyTheme("industrial", el, { case: "controls" });

    expect(el.getAttribute("data-case")).toBe("controls");
    expect(el.getAttribute("data-mono")).toBe("fragment");
    expect(el.getAttribute("data-frame")).toBe("box");
  });

  it("reads the letter cases before the ladder as their nearest step", () => {
    expect(letterCase("upper")).toBe("headings");
    expect(letterCase("lower")).toBe("none");
    // "normal" meant the theme's own, which is no adjustment at all now.
    expect(letterCase("normal")).toBeUndefined();
    expect(letterCase("labels")).toBe("labels");
  });

  it("rejects non-fonts", () => {
    expect(isMono("plex")).toBe(true);
    expect(isMono("comic-sans")).toBe(false);
    expect(isTypeRole("mono")).toBe(true);
    expect(isTypeRole("Mono")).toBe(false);
    expect(isLetterCase("headings")).toBe(true);
    expect(isLetterCase("upper")).toBe(false);
  });

  describe("number-key switching", () => {
    it("maps 1..n onto the theme list in order", () => {
      expect(themeForKey("1", null, false)).toBe(THEMES[0]);
      expect(themeForKey("5", null, false)).toBe(THEMES[4]);
    });

    it("runs 1 to 9 then 0, and a key with no theme behind it does nothing", () => {
      const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
      keys.forEach((key, i) => {
        expect(themeForKey(key, null, false), key).toBe((THEMES as readonly string[])[i] ?? null);
      });
      // Two digits are never a key, however many themes there are.
      expect(themeForKey("10", null, false)).toBeNull();
    });

    it("never fires while the user is typing", () => {
      // The case that actually matters: a bare "2" typed into meeting notes
      // must be a two, not a theme change.
      for (const tag of ["input", "textarea", "select"]) {
        const el = document.createElement(tag);
        expect(themeForKey("2", el, false), tag).toBeNull();
      }

      const editable = document.createElement("div");
      editable.contentEditable = "true";
      // jsdom does not derive isContentEditable from the attribute.
      Object.defineProperty(editable, "isContentEditable", { value: true });
      expect(themeForKey("2", editable, false)).toBeNull();
    });

    it("leaves modified chords to whatever else owns them", () => {
      expect(themeForKey("2", null, true)).toBeNull();
    });

    it("ignores everything that is not a digit", () => {
      expect(themeForKey("t", null, false)).toBeNull();
      expect(themeForKey("Enter", null, false)).toBeNull();
    });
  });

  it("rejects non-themes", () => {
    expect(isTheme("carbon")).toBe(true);
    expect(isTheme("Terminal")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});
