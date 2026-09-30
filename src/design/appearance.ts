import { createContext, useContext } from "react";
import {
  CASES,
  FAMILIES,
  type Family,
  FRAMES,
  isFrame,
  isLetterCase,
  isMono,
  isTheme,
  isTypeRole,
  loadTheme,
  MONOS,
  type Overrides,
  saveTheme,
  THEME_FAMILY,
  type Theme,
  TYPES,
  themesIn,
} from "./theme";

/**
 * A treatment of the glass the app is shown through (CONTEXT.md).
 *
 * These replaced CRT mode, which drew a whole monitor — screws, lights, a
 * vent — around the app. The bezel was the part that aged badly; what was
 * worth keeping was the glass, and the glass is a filter.
 */
export const FILTERS = [
  "none",
  "scanlines",
  "glow",
  "dots",
  "dither",
  "vignette",
  "crt",
  "vhs",
] as const;

export type Filter = (typeof FILTERS)[number];

export const FILTER_NOTES: Record<Filter, string> = {
  none: "Clean glass.",
  scanlines: "Horizontal lines, as a raster display draws them.",
  glow: "Phosphor bloom around every letter.",
  dots: "A dot grid over everything, like an LED sign up close.",
  dither: "A fine checkerboard, as a one-bit screen fakes a grey.",
  vignette: "The corners fall into shadow.",
  crt: "A tube: scanlines, an RGB grille, glow, a rolling refresh bar, rounded glass. It switches on.",
  vhs: "A worn tape: colour fringing, grain, flicker and a tracking band drifting down.",
};

export function isFilter(value: unknown): value is Filter {
  return typeof value === "string" && (FILTERS as readonly string[]).includes(value);
}

/**
 * How hard the filter is laid on.
 *
 * Taste varies more here than anywhere else in the app, and so does the
 * screen: what reads as texture on one monitor is invisible on another. The
 * first version shipped a single, faint setting and nobody could see it.
 */
export const STRENGTHS = ["soft", "medium", "strong"] as const;

export type Strength = (typeof STRENGTHS)[number];

export function isStrength(value: unknown): value is Strength {
  return typeof value === "string" && (STRENGTHS as readonly string[]).includes(value);
}

/**
 * What each family remembers.
 *
 * Per family rather than app-wide, so flipping between Modern and Retro
 * brings back the whole of each: its last theme and the glass it was shown
 * through. Motion, sound and density join this as they are built.
 */
export interface FamilySettings {
  filter: Filter;
  strength: Strength;
  /** The theme last chosen in this family, restored when flipping back to it. */
  theme?: Theme | undefined;
}

export const FAMILY_DEFAULTS: Record<Family, FamilySettings> = {
  retro: { filter: "scanlines", strength: "medium" },
  modern: { filter: "none", strength: "medium" },
};

/**
 * The look as a whole: a theme plus any axis the user has overridden.
 *
 * The axes were gallery-only until the Appearance page. Living with a theme
 * for a few days is the test that decides the design (docs/11-PLAN.md, Phase
 * C), and that test is only fair if the variations worth trying survive a
 * restart instead of living in a dev harness.
 */
export interface Appearance {
  theme: Theme;
  overrides: Overrides;
  families: Record<Family, FamilySettings>;
}

const OVERRIDES_KEY = "trace.appearance.overrides";
const FAMILIES_KEY = "trace.appearance.families";
/** Read once, to carry a CRT-mode choice over into the filter that replaced it. */
const LEGACY_CRT_KEY = "trace.appearance.crt";

export function loadAppearance(): Appearance {
  const theme = loadTheme();
  return { theme, overrides: loadOverrides(), families: loadFamilies(theme) };
}

function loadFamilies(theme: Theme): Record<Family, FamilySettings> {
  const families = { retro: { ...FAMILY_DEFAULTS.retro }, modern: { ...FAMILY_DEFAULTS.modern } };
  try {
    const raw = JSON.parse(localStorage.getItem(FAMILIES_KEY) ?? "null") as Record<
      string,
      Record<string, unknown> | undefined
    > | null;
    if (raw) {
      for (const f of FAMILIES) {
        const saved = raw[f];
        if (isFilter(saved?.filter)) families[f].filter = saved.filter;
        if (isStrength(saved?.strength)) families[f].strength = saved.strength;
        if (isTheme(saved?.theme) && THEME_FAMILY[saved.theme] === f)
          families[f] = {
            ...families[f],
            theme: saved.theme,
          };
      }
    } else if (localStorage.getItem(LEGACY_CRT_KEY) === "on") {
      // Someone who turned CRT mode on should not lose it to an update. It
      // lands on the family they were using, which is where they saw it.
      families[THEME_FAMILY[theme]].filter = "crt";
    }
  } catch {
    // Unreadable storage: the defaults are a fine answer.
  }
  return families;
}

function loadOverrides(): Overrides {
  try {
    const raw = JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? "{}") as Record<string, unknown>;
    // Each field validated on its own, so one stale value from an older
    // build drops that axis rather than the whole look.
    return {
      frame: isFrame(raw.frame) ? raw.frame : undefined,
      mono: isMono(raw.mono) ? raw.mono : undefined,
      role: isTypeRole(raw.role) ? raw.role : undefined,
      case: isLetterCase(raw.case) ? raw.case : undefined,
    };
  } catch {
    return {};
  }
}

export function saveAppearance(a: Appearance): void {
  saveTheme(a.theme);
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(a.overrides));
    localStorage.setItem(FAMILIES_KEY, JSON.stringify(a.families));
    localStorage.removeItem(LEGACY_CRT_KEY);
  } catch {
    // Not worth surfacing — the choice simply does not persist.
  }
}

/** The filter in force: the one the current theme's family remembers. */
export function currentFilter(a: Appearance): Filter {
  return a.families[THEME_FAMILY[a.theme]].filter;
}

/** How hard the filter in force is laid on. */
export function currentStrength(a: Appearance): Strength {
  return a.families[THEME_FAMILY[a.theme]].strength;
}

/** Set or clear the screen filter on the element that carries the look. */
export function applyFilter(filter: Filter, strength: Strength, target: HTMLElement): void {
  if (filter === "none") {
    target.removeAttribute("data-filter");
    target.removeAttribute("data-filter-strength");
    return;
  }
  target.setAttribute("data-filter", filter);
  target.setAttribute("data-filter-strength", strength);
}

export const AXES = {
  frame: { label: "Frame", options: FRAMES },
  role: { label: "Type", options: TYPES },
  mono: { label: "Mono font", options: MONOS },
  case: { label: "Letter case", options: CASES },
} as const;

export type Axis = keyof typeof AXES;

export interface AppearanceControl {
  appearance: Appearance;
  setTheme: (theme: Theme) => void;
  /** Switch family, restoring the theme last used in it. */
  setFamily: (family: Family) => void;
  /** Set the filter for the current theme's family. */
  setFilter: (filter: Filter) => void;
  setStrength: (strength: Strength) => void;
  setAxis: (axis: Axis, value: string | undefined) => void;
  reset: () => void;
}

/*
 * A context rather than props, because the Appearance page sits several
 * levels below the shell that applies the look, and the gallery needs to hand
 * it a different owner without either knowing.
 */
export const AppearanceContext = createContext<AppearanceControl | null>(null);

export function useAppearanceControl(): AppearanceControl {
  const control = useContext(AppearanceContext);
  if (!control) throw new Error("useAppearanceControl outside an AppearanceContext");
  return control;
}

/** Apply one axis change to a look. Pure, so it can be tested. */
export function withAxis(a: Appearance, axis: Axis, value: string | undefined): Appearance {
  const valid =
    value === undefined ||
    (axis === "frame" && isFrame(value)) ||
    (axis === "role" && isTypeRole(value)) ||
    (axis === "mono" && isMono(value)) ||
    (axis === "case" && isLetterCase(value));
  if (!valid) return a;
  return { ...a, overrides: { ...a.overrides, [axis]: value } };
}

/** Choose a theme, and remember it as its family's latest. */
export function withTheme(a: Appearance, theme: string): Appearance {
  if (!isTheme(theme)) return a;
  const family = THEME_FAMILY[theme];
  return {
    ...a,
    theme,
    families: { ...a.families, [family]: { ...a.families[family], theme } },
  };
}

/** Flip to a family, landing on the theme last used in it. */
export function withFamily(a: Appearance, family: Family): Appearance {
  if (THEME_FAMILY[a.theme] === family) return a;
  const remembered = a.families[family].theme;
  return withTheme(a, remembered ?? themesIn(family)[0] ?? "terminal");
}

export function withFilter(a: Appearance, filter: string): Appearance {
  if (!isFilter(filter)) return a;
  const family = THEME_FAMILY[a.theme];
  return { ...a, families: { ...a.families, [family]: { ...a.families[family], filter } } };
}

export function withStrength(a: Appearance, strength: string): Appearance {
  if (!isStrength(strength)) return a;
  const family = THEME_FAMILY[a.theme];
  return { ...a, families: { ...a.families, [family]: { ...a.families[family], strength } } };
}
