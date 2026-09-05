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

export const THEMES = ["terminal", "report", "console", "industrial", "termcn"] as const;

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

/**
 * Letter case for monospace system text.
 *
 * `normal` means "leave it to the theme" rather than "force sentence case",
 * so selecting it changes nothing.
 */
export const CASES = ["normal", "upper", "lower"] as const;

export type LetterCase = (typeof CASES)[number];

export const THEME_NOTES: Record<Theme, string> = {
  terminal: "The default. Phosphor green, an instrument from an alternate 1987.",
  report: "TR-100 machine report — monochrome, boxed, dithered. No accent at all.",
  console: "conky — dense rows, and a hue ramp that makes the meters readable at a glance.",
  industrial: "R-1 / LAB — hot orange as a brand colour, not a status accent.",
  termcn: "termcn — pure black, saturated ANSI, heavy square boxes. The loudest of the five.",
};

/** Each look's own framing. The gallery may override it to explore combinations. */
export const THEME_FRAME: Record<Theme, Frame> = {
  terminal: "rule",
  report: "box",
  console: "rule",
  industrial: "box",
  termcn: "box",
};

/** Each look's starting typeface pairing. All of it is overridable in the gallery. */
export const THEME_TYPE: Record<Theme, { mono: Mono; role: TypeRole; case: LetterCase }> = {
  // Today's default, unchanged.
  terminal: { mono: "geist", role: "hybrid", case: "normal" },
  // A machine report is monospace all the way down — that is what makes it
  // a report rather than a document about one — and the TR-100 shouts.
  report: { mono: "plex", role: "mono", case: "upper" },
  // conky is a readout: mono everywhere, tight, even, and quiet.
  console: { mono: "jetbrains", role: "mono", case: "lower" },
  // Industrial signage is a grotesque, with mono for the data.
  industrial: { mono: "fragment", role: "hybrid", case: "upper" },
  // Their shots are bold Title Case, not caps — weight does the shouting.
  termcn: { mono: "jetbrains", role: "mono", case: "normal" },
};

export const MONO_NOTES: Record<Mono, string> = {
  geist: "Geist Mono — the current default.",
  fragment: "Fragment Mono — single weight, wide, quite characterful.",
  jetbrains: "JetBrains Mono — tall x-height, built for long reading.",
  plex: "IBM Plex Mono — the most document-like of the four.",
};

export const CASE_NOTES: Record<LetterCase, string> = {
  normal: "As written — the theme's own label casing still applies.",
  upper: "SYSTEM TEXT IN CAPS. Not prose; an uppercase paragraph is unreadable.",
  lower: "system text in lowercase. quieter, more modern-terminal.",
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
  case?: LetterCase | undefined;
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
  target.setAttribute("data-case", o.case ?? type.case);
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
  if (!/^[1-9]$/.test(key)) return null;
  return THEMES[Number(key) - 1] ?? null;
}
