/**
 * Theme selection.
 *
 * A theme is a set of token overrides (see `themes.css`), applied by setting
 * `data-theme` on an element. Everything below that element re-skins, because
 * every Tailwind utility in the app compiles to `var(--token)`.
 *
 * The target is a parameter rather than always the document root, so the
 * gallery can theme only its preview pane. If the harness chrome re-skinned
 * along with the app, you could not tell which parts of the screen were the
 * product and which were the tooling — which would make it useless for
 * exactly the judgement it exists to support.
 */

export const THEMES = ["terminal", "futurist", "quiet"] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_NOTES: Record<Theme, string> = {
  terminal: "The default. An instrument from an alternate 1987.",
  futurist: "Sketch — colder, sharper, sans labels, ice accent.",
  quiet: "Sketch — the control. A document, not an interface.",
};

/** `terminal` is the `@theme` default, so selecting it removes the attribute. */
export function applyTheme(theme: Theme, target: HTMLElement): void {
  if (theme === "terminal") target.removeAttribute("data-theme");
  else target.setAttribute("data-theme", theme);
}

const STORAGE_KEY = "trace.theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
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
