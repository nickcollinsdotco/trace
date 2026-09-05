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

export const THEMES = ["terminal", "report", "console", "industrial"] as const;

export type Theme = (typeof THEMES)[number];

export const FRAMES = ["rule", "box"] as const;

export type Frame = (typeof FRAMES)[number];

/** Monospace families available to compare. Exact choices are still open. */
export const MONOS = ["geist", "fragment", "jetbrains", "plex"] as const;

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

export const THEME_NOTES: Record<Theme, string> = {
  terminal: "The default. Phosphor green, an instrument from an alternate 1987.",
  report: "TR-100 machine report — monochrome, boxed, dithered. No accent at all.",
  console: "conky — dense rows, and a hue ramp that makes the meters readable at a glance.",
  industrial: "R-1 / LAB — hot orange as a brand colour, not a status accent.",
};

/** Each look's own framing. The gallery may override it to explore combinations. */
export const THEME_FRAME: Record<Theme, Frame> = {
  terminal: "rule",
  report: "box",
  console: "rule",
  industrial: "box",
};

/** Each look's starting typeface pairing. All of it is overridable in the gallery. */
export const THEME_TYPE: Record<Theme, { mono: Mono; role: TypeRole }> = {
  // Today's default, unchanged.
  terminal: { mono: "geist", role: "hybrid" },
  // A machine report is monospace all the way down — that is what makes it
  // a report rather than a document about one.
  report: { mono: "plex", role: "mono" },
  // conky is a readout: mono everywhere, tight and even.
  console: { mono: "jetbrains", role: "mono" },
  // Industrial signage is a grotesque, with mono for the data.
  industrial: { mono: "fragment", role: "hybrid" },
};

export const MONO_NOTES: Record<Mono, string> = {
  geist: "Geist Mono — the current default.",
  fragment: "Fragment Mono — single weight, wide, quite characterful.",
  jetbrains: "JetBrains Mono — tall x-height, built for long reading.",
  plex: "IBM Plex Mono — the most document-like of the four.",
};

export const TYPE_NOTES: Record<TypeRole, string> = {
  hybrid: "Sans for prose, mono for system language.",
  mono: "Monospace everywhere, including reading mode.",
  sans: "Proportional everywhere, including transcripts.",
};

export interface Overrides {
  frame?: Frame | undefined;
  mono?: Mono | undefined;
  role?: TypeRole | undefined;
}

/**
 * `terminal` is the `@theme` default, so selecting it removes the attribute.
 *
 * Everything else is an attribute rather than a token, because CSS cannot
 * select on a custom property's value. Each falls back to the theme's own
 * choice, so the gallery can vary one axis at a time.
 */
export function applyTheme(theme: Theme, target: HTMLElement, o: Overrides = {}): void {
  if (theme === "terminal") target.removeAttribute("data-theme");
  else target.setAttribute("data-theme", theme);

  const type = THEME_TYPE[theme];
  target.setAttribute("data-frame", o.frame ?? THEME_FRAME[theme]);
  target.setAttribute("data-mono", o.mono ?? type.mono);
  target.setAttribute("data-type", o.role ?? type.role);
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

export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Private browsing, or storage disabled. The default is a fine answer.
  }
  return "terminal";
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not worth surfacing — the choice simply does not persist.
  }
}
