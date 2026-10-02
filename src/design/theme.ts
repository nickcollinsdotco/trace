/**
 * Theme selection.
 *
 * A theme is a set of token overrides (see `themes.css`), applied by setting
 * `data-theme` on an element. Everything below it re-skins, because every
 * Tailwind utility in the app compiles to `var(--token)`.
 *
 * Framing is the exception, and has to be. CSS cannot select on a custom
 * property's *value*, so "does a section render as a rule or as a box" cannot
 * live in a token — it is a second attribute, set here from each theme's
 * declared preference. That turns out to be a feature for prototyping: the
 * gallery can vary framing independently of palette and ask "what does
 * `terminal` look like boxed?" without inventing a fourth theme to find out.
 *
 * The target is a parameter rather than always the document root, so the
 * gallery can theme only its preview pane. If the harness chrome re-skinned
 * along with the app, you could not tell which parts of the screen were the
 * product and which were the tooling.
 */

/**
 * Every built-in theme, in the order the number keys reach them: 1–9, then
 * 0 for the tenth. New themes go on the end, so adding one never moves a
 * key; retiring one does, and the user is told the new order.
 *
 * Retired 2026-10-01, on the user's call after living with them: `console`
 * (conky's hue-ramp meters) and `council` (the conference badge). A saved
 * choice of either falls back to the default, and its adjustments go with it.
 *
 * Renamed 2026-10-02: `terminal` is `carbon`, and Modern rather than Retro —
 * Geist, a clean ground and one green accent read as a modern app, and the
 * name collided with the family's old one. `themeId` reads the old name.
 */
export const THEMES = [
  "carbon",
  "report",
  "industrial",
  "termcn",
  "graphite",
  "shell",
  "index",
  "vault",
  "teletext",
  "scope",
] as const;

export type Theme = (typeof THEMES)[number];

/**
 * Two families, Modern and Retro, each with its own themes.
 *
 * Retro rather than "terminal", which was also the name of a theme inside it
 * — "switch to terminal" meant two things (CONTEXT.md).
 *
 * A family is not a theme: it decides whether the app speaks terminal at all
 * — prompts, box-drawing corners, caps — where a theme only re-skins the one
 * language it belongs to. That is a layout decision, which the switch budget
 * in themes.css always said themes should not make; so it is an attribute of
 * its own, `data-family`, read by `family.css`, and no component forks on it.
 */
export const FAMILIES = ["modern", "retro"] as const;

export type Family = (typeof FAMILIES)[number];

export const FAMILY_NOTES: Record<Family, string> = {
  modern: "A contemporary app: sans type, soft cards, rounded controls, no terminal glyphs.",
  retro: "An instrument from an alternate 1987: monospace system text, rules and boxes.",
};

/** The themes in a family, in switcher order. */
export function themesIn(family: Family): Theme[] {
  return THEMES.filter((t) => THEME_FAMILY[t] === family);
}

/**
 * Sections framed as a rule, a drawn box with an inlaid title, a card — the
 * modern family's soft panel with its title inside — or ascii: no box at all,
 * the title in brackets and the rule typed out in line-drawing characters.
 */
export const FRAMES = ["rule", "box", "card", "ascii"] as const;

export type Frame = (typeof FRAMES)[number];

/** Monospace families available to compare. Exact choices are still open. */
export const MONOS = ["geist", "fragment", "jetbrains", "plex", "vt323", "sharetech"] as const;

export type Mono = (typeof MONOS)[number];

/**
 * Where monospace is used.
 *
 * The question the eyebrow labels could not answer: a terminal aesthetic on
 * labels alone is decoration, on the body it is a commitment. `mono` is the
 * one to judge against a 90-minute transcript.
 */
export const TYPES = ["hybrid", "mono", "sans"] as const;

export type TypeRole = (typeof TYPES)[number];

/**
 * How far capitals reach, as a ladder (type.css): each step adds a role —
 * labels and tags, then buttons and navigation, then titles. Prose never.
 */
export const CASES = ["none", "labels", "controls", "headings"] as const;

export type LetterCase = (typeof CASES)[number];

/**
 * What a theme is, besides its colours: its family, its framing, its type,
 * and a line saying what it is for.
 *
 * Data, in one place, rather than four maps that had to agree. The colours
 * and the few structural rules a theme needs stay in themes.css, where the
 * cascade that lets the type axes override them is proven — moving them into
 * script would have put their order against type.css and tokens.css at risk
 * for nothing the user could see. Adjustments and, later, custom themes are
 * data laid over a built-in, which is what the builder needs.
 */
export interface ThemeDef {
  family: Family;
  note: string;
  frame: Frame;
  type: { mono: Mono; role: TypeRole; case: LetterCase };
  /**
   * How a text field shows where to type: a drawn `box`, or a `line` under
   * it with the terminal's `>` before it. One or the other — Index once
   * drew a box, a `>` and a blinking block, three ways of saying one thing.
   */
  field: FieldStyle;
}

export type FieldStyle = "box" | "line";

export const THEME_DEFS: Record<Theme, ThemeDef> = {
  carbon: {
    family: "modern",
    note: "The default. Phosphor green on near-black, Geist throughout, the accent doing the work.",
    frame: "rule",
    type: { mono: "geist", role: "hybrid", case: "labels" },
    field: "box",
  },
  report: {
    family: "retro",
    note: "TR-100 machine report — monochrome, boxed, dithered. No accent at all.",
    frame: "box",
    // A machine report is monospace all the way down — that is what makes it
    // a report rather than a document about one — and the TR-100 shouts.
    type: { mono: "plex", role: "mono", case: "headings" },
    field: "line",
  },
  industrial: {
    family: "retro",
    note: "R-1 / LAB — hot orange as a brand colour, not a status accent.",
    frame: "box",
    // Industrial signage is a grotesque, with mono for the data.
    type: { mono: "fragment", role: "hybrid", case: "headings" },
    field: "box",
  },
  termcn: {
    family: "retro",
    note: "termcn — pure black, saturated ANSI, heavy square boxes. The loudest of them.",
    frame: "box",
    // Their shots are bold Title Case, not caps — weight does the shouting.
    type: { mono: "jetbrains", role: "mono", case: "none" },
    field: "box",
  },
  graphite: {
    family: "modern",
    note: "Neutral greys, white as the accent, soft cards and pill controls — shadcn-like.",
    frame: "card",
    // Proportional throughout: system text in mono is exactly the terminal
    // voice this family leaves behind. Timestamps keep tabular figures.
    type: { mono: "geist", role: "sans", case: "none" },
    field: "box",
  },
  shell: {
    family: "retro",
    note: "GRiD Compass and a terminal session: amber VT323, no boxes, headings in brackets.",
    frame: "ascii",
    type: { mono: "vt323", role: "mono", case: "controls" },
    field: "line",
  },
  index: {
    family: "retro",
    note: "A studio index: pixel capitals, dense rows, a row lit up in full as you pass it.",
    frame: "rule",
    type: { mono: "sharetech", role: "mono", case: "headings" },
    field: "box",
  },
  vault: {
    family: "retro",
    note: "A wrist computer from a bunker: phosphor green, condensed type, bracketed tabs.",
    frame: "rule",
    type: { mono: "sharetech", role: "sans", case: "headings" },
    field: "box",
  },
  teletext: {
    family: "retro",
    note: "Ceefax page 100: seven hard colours on black, blue story bands, Fastext along the bottom.",
    frame: "rule",
    type: { mono: "vt323", role: "mono", case: "controls" },
    field: "box",
  },
  scope: {
    family: "retro",
    note: "A Tektronix scope: P31 green over a 10 × 8 graticule, readouts in the corners.",
    frame: "rule",
    type: { mono: "sharetech", role: "mono", case: "headings" },
    field: "box",
  },
};

export const THEME_FAMILY = mapThemes((d) => d.family);
export const THEME_NOTES = mapThemes((d) => d.note);
/** Each theme's own framing. Adjustments may override it. */
export const THEME_FRAME = mapThemes((d) => d.frame);
/** Each theme's starting typeface pairing. Adjustments may override any of it. */
export const THEME_TYPE = mapThemes((d) => d.type);

function mapThemes<T>(pick: (d: ThemeDef) => T): Record<Theme, T> {
  return Object.fromEntries(THEMES.map((t) => [t, pick(THEME_DEFS[t])])) as Record<Theme, T>;
}

export const MONO_NOTES: Record<Mono, string> = {
  geist: "Geist Mono — the current default.",
  fragment: "Fragment Mono — single weight, wide, quite characterful.",
  jetbrains: "JetBrains Mono — tall x-height, built for long reading.",
  plex: "IBM Plex Mono — the most document-like of the four.",
  vt323: "VT323 — a DEC terminal's bitmap face, drawn large.",
  sharetech: "Share Tech Mono — narrow and technical, a readout's face.",
};

export const CASE_NOTES: Record<LetterCase, string> = {
  none: "Nothing in capitals.",
  labels: "Section and field labels, and tags.",
  controls: "Labels, tags, buttons and navigation.",
  headings: "All of those, and titles. Never prose, notes or transcripts.",
};

/**
 * The letter case values before the ladder: `upper` put all system text in
 * capitals, the nearest step being headings; `lower` is none; `normal`
 * meant the theme's own, which is what no adjustment means now.
 */
export function letterCase(value: unknown): LetterCase | undefined {
  if (value === "upper") return "headings";
  if (value === "lower") return "none";
  return isLetterCase(value) ? value : undefined;
}

export const TYPE_NOTES: Record<TypeRole, string> = {
  hybrid: "Sans for prose, mono for system language.",
  mono: "Monospace everywhere, including reading mode.",
  sans: "Proportional everywhere, including transcripts.",
};

export interface Overrides {
  frame?: Frame | undefined;
  mono?: Mono | undefined;
  role?: TypeRole | undefined;
  case?: LetterCase | undefined;
}

/**
 * `carbon` is the `@theme` default, so selecting it removes the attribute.
 *
 * Everything else is an attribute rather than a token, because CSS cannot
 * select on a custom property's value. Each falls back to the theme's own
 * choice, so the gallery can vary one axis at a time.
 */
export function applyTheme(theme: Theme, target: HTMLElement, o: Overrides = {}): void {
  const before = {
    theme: target.getAttribute("data-theme"),
    case: target.getAttribute("data-case"),
  };
  if (theme === "carbon") target.removeAttribute("data-theme");
  else target.setAttribute("data-theme", theme);

  const type = THEME_TYPE[theme];
  target.setAttribute("data-family", THEME_FAMILY[theme]);
  target.setAttribute("data-frame", o.frame ?? THEME_FRAME[theme]);
  target.setAttribute("data-mono", o.mono ?? type.mono);
  target.setAttribute("data-type", o.role ?? type.role);
  target.setAttribute("data-case", o.case ?? type.case);
  target.setAttribute("data-field", THEME_DEFS[theme].field);

  // The capitals ladder moved on the same theme: the screen redraws
  // (type.css). Not on a theme change — that is a new look, not the same
  // one changing its mind.
  const now = target.getAttribute("data-case");
  if (before.case && before.case !== now && before.theme === target.getAttribute("data-theme")) {
    redraw(target);
  }
}

const redrawing = new WeakMap<HTMLElement, number>();
const REDRAW_MS = 420;

function redraw(target: HTMLElement) {
  window.clearTimeout(redrawing.get(target));
  // Off and on again, so a second change mid-sweep starts a fresh one.
  target.removeAttribute("data-redraw");
  void target.offsetWidth;
  target.setAttribute("data-redraw", "");
  redrawing.set(
    target,
    window.setTimeout(() => target.removeAttribute("data-redraw"), REDRAW_MS),
  );
}

const STORAGE_KEY = "trace.theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function isFrame(value: unknown): value is Frame {
  return typeof value === "string" && (FRAMES as readonly string[]).includes(value);
}

export function isMono(value: unknown): value is Mono {
  return typeof value === "string" && (MONOS as readonly string[]).includes(value);
}

export function isTypeRole(value: unknown): value is TypeRole {
  return typeof value === "string" && (TYPES as readonly string[]).includes(value);
}

export function isLetterCase(value: unknown): value is LetterCase {
  return typeof value === "string" && (CASES as readonly string[]).includes(value);
}

export function loadTheme(): Theme {
  try {
    const stored = themeId(localStorage.getItem(STORAGE_KEY));
    if (isTheme(stored)) return stored;
  } catch {
    // Private browsing, or storage disabled. The default is a fine answer.
  }
  return "carbon";
}

/** Names a theme went by before, read as the theme they became. */
const RENAMED: Record<string, Theme> = { terminal: "carbon" };

/** A stored theme name, brought up to date. Anything else passes through. */
export function themeId(value: unknown): unknown {
  return typeof value === "string" ? (RENAMED[value] ?? value) : value;
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not worth surfacing — the choice simply does not persist.
  }
}

/**
 * Whether a keystroke belongs to whatever the user is typing into.
 *
 * Bare number keys are the fastest way to flip between looks, and they are
 * also digits someone might legitimately be typing into a meeting note. The
 * shortcut has to lose that argument every time.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * The theme a keyboard event selects, or null if it selects none.
 *
 * Pure, so the awkward part — which is the guarding, not the indexing — can
 * be tested without a DOM.
 */
export function themeForKey(
  key: string,
  target: EventTarget | null,
  modified: boolean,
): Theme | null {
  if (modified || isTypingTarget(target)) return null;
  if (!/^[0-9]$/.test(key)) return null;
  // 1 is the first theme and 0 the tenth, as on the keyboard's own row.
  return THEMES[key === "0" ? 9 : Number(key) - 1] ?? null;
}
