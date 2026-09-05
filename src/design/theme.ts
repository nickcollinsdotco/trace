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

/** `terminal` is the `@theme` default, so selecting it removes the attribute. */
export function applyTheme(theme: Theme, target: HTMLElement, frame?: Frame): void {
  if (theme === "terminal") target.removeAttribute("data-theme");
  else target.setAttribute("data-theme", theme);

  target.setAttribute("data-frame", frame ?? THEME_FRAME[theme]);
}

const STORAGE_KEY = "trace.theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function isFrame(value: unknown): value is Frame {
  return typeof value === "string" && (FRAMES as readonly string[]).includes(value);
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
