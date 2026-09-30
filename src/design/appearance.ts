import { createContext, useContext } from "react";
import {
  type Effect,
  type EffectSetting,
  type Preset,
  presetScreen,
  readScreen,
  type Screen,
  withEffectSetting,
} from "./screen";
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
 * What each family remembers.
 *
 * Per family rather than app-wide, so flipping between Modern and Retro
 * brings back the whole of each: its last theme and the glass it was shown
 * through. Motion, sound and density join this as they are built.
 */
export interface FamilySettings {
  screen: Screen;
  /** The theme last chosen in this family, restored when flipping back to it. */
  theme?: Theme | undefined;
}

/*
 * Retro starts on lofi.cafe's lines alone, at the strength it uses them —
 * texture that shades the letters without cutting them. Modern starts clean.
 */
export const FAMILY_DEFAULTS: Record<Family, FamilySettings> = {
  retro: { screen: presetScreen("lines") },
  modern: { screen: presetScreen("none") },
};

/** Fresh family settings, so no two looks ever share a mutable default. */
export function defaultFamilies(): Record<Family, FamilySettings> {
  return { retro: { ...FAMILY_DEFAULTS.retro }, modern: { ...FAMILY_DEFAULTS.modern } };
}

/*
 * The single filters of 0.7.0–0.7.1, and CRT mode before them, carried over
 * to the nearest mix. None of the old ones survives as it was: the effects
 * were rebuilt because they made text unreadable.
 */
const LEGACY_FILTER: Record<string, Preset> = {
  crt: "crt",
  vhs: "film",
  dots: "grid",
  glow: "lofi",
  scanlines: "lines",
};

/**
 * The look as a whole: a theme, the adjustments made to each theme, and what
 * each family remembers.
 *
 * Adjustments belong to their theme (CONTEXT.md, docs/13 Q22). They were one
 * global set at first, so Plex set on `terminal` followed you into
 * `industrial` and no theme looked as designed once anything was touched.
 * Now each theme keeps its own and Reset takes it back as it shipped.
 */
export interface Appearance {
  theme: Theme;
  adjustments: Partial<Record<Theme, Overrides>>;
  families: Record<Family, FamilySettings>;
}

const ADJUSTMENTS_KEY = "trace.appearance.adjustments";
/** Read once, to move the old global overrides onto the theme they were made on. */
const OVERRIDES_KEY = "trace.appearance.overrides";
const FAMILIES_KEY = "trace.appearance.families";
/** Read once, to carry a CRT-mode choice over into the filter that replaced it. */
const LEGACY_CRT_KEY = "trace.appearance.crt";

export function loadAppearance(): Appearance {
  const theme = loadTheme();
  return { theme, adjustments: loadAdjustments(theme), families: loadFamilies(theme) };
}

function loadFamilies(theme: Theme): Record<Family, FamilySettings> {
  const families = defaultFamilies();
  try {
    const raw = JSON.parse(localStorage.getItem(FAMILIES_KEY) ?? "null") as Record<
      string,
      Record<string, unknown> | undefined
    > | null;
    if (raw) {
      for (const f of FAMILIES) {
        const saved = raw[f];
        const legacy = typeof saved?.filter === "string" ? LEGACY_FILTER[saved.filter] : undefined;
        const screen = legacy
          ? presetScreen(legacy)
          : readScreen(saved?.screen, families[f].screen);
        families[f] = { screen };
        if (isTheme(saved?.theme) && THEME_FAMILY[saved.theme] === f) {
          families[f].theme = saved.theme;
        }
      }
    } else if (localStorage.getItem(LEGACY_CRT_KEY) === "on") {
      // Someone who turned CRT mode on should not lose it to an update. It
      // lands on the family they were using, which is where they saw it.
      families[THEME_FAMILY[theme]] = { screen: presetScreen("crt") };
    }
  } catch {
    // Unreadable storage: the defaults are a fine answer.
  }
  return families;
}

function loadAdjustments(theme: Theme): Partial<Record<Theme, Overrides>> {
  try {
    const saved = localStorage.getItem(ADJUSTMENTS_KEY);
    if (saved !== null) {
      const raw = JSON.parse(saved) as Record<string, unknown>;
      const out: Partial<Record<Theme, Overrides>> = {};
      for (const [t, o] of Object.entries(raw)) {
        const overrides = readOverrides(o);
        if (isTheme(t) && hasAny(overrides)) out[t] = overrides;
      }
      return out;
    }
    // Before adjustments were per theme: whatever was set becomes the
    // current theme's, and only its — nothing on screen changes by updating.
    const old = readOverrides(JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? "{}"));
    return hasAny(old) ? { [theme]: old } : {};
  } catch {
    return {};
  }
}

/**
 * One theme's adjustments, read back. Each field validated on its own, so one
 * stale value from an older build drops that axis rather than the lot.
 */
function readOverrides(raw: unknown): Overrides {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  return {
    frame: isFrame(o.frame) ? o.frame : undefined,
    mono: isMono(o.mono) ? o.mono : undefined,
    role: isTypeRole(o.role) ? o.role : undefined,
    case: isLetterCase(o.case) ? o.case : undefined,
  };
}

function hasAny(o: Overrides): boolean {
  return Object.values(o).some((v) => v !== undefined);
}

/** The adjustments in force: the current theme's own. */
export function currentAdjustments(a: Appearance): Overrides {
  return a.adjustments[a.theme] ?? {};
}

/** Whether a theme has been changed from how it shipped. */
export function isAdjusted(a: Appearance, theme: Theme): boolean {
  return hasAny(a.adjustments[theme] ?? {});
}

export function saveAppearance(a: Appearance): void {
  saveTheme(a.theme);
  try {
    localStorage.setItem(ADJUSTMENTS_KEY, JSON.stringify(a.adjustments));
    localStorage.removeItem(OVERRIDES_KEY);
    localStorage.setItem(FAMILIES_KEY, JSON.stringify(a.families));
    localStorage.removeItem(LEGACY_CRT_KEY);
  } catch {
    // Not worth surfacing — the choice simply does not persist.
  }
}

/** The screen in force: the one the current theme's family remembers. */
export function currentScreen(a: Appearance): Screen {
  return a.families[THEME_FAMILY[a.theme]].screen;
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
  /** Replace the current family's screen with a preset. */
  setPreset: (preset: Preset) => void;
  /** Change one effect of the current family's screen. */
  setEffect: (effect: Effect, patch: Partial<EffectSetting>) => void;
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

/** Adjust one axis of the current theme. Pure, so it can be tested. */
export function withAxis(a: Appearance, axis: Axis, value: string | undefined): Appearance {
  const valid =
    value === undefined ||
    (axis === "frame" && isFrame(value)) ||
    (axis === "role" && isTypeRole(value)) ||
    (axis === "mono" && isMono(value)) ||
    (axis === "case" && isLetterCase(value));
  if (!valid) return a;
  const next = { ...currentAdjustments(a), [axis]: value };
  return { ...a, adjustments: { ...a.adjustments, [a.theme]: next } };
}

/** Put the current theme back as it shipped. */
export function withReset(a: Appearance): Appearance {
  const { [a.theme]: _, ...rest } = a.adjustments;
  return { ...a, adjustments: rest };
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

/** The current family's screen, replaced or changed. Pure, so it can be tested. */
function withScreen(a: Appearance, change: (screen: Screen) => Screen): Appearance {
  const family = THEME_FAMILY[a.theme];
  const settings = a.families[family];
  return {
    ...a,
    families: { ...a.families, [family]: { ...settings, screen: change(settings.screen) } },
  };
}

export function withPreset(a: Appearance, preset: Preset): Appearance {
  return withScreen(a, () => presetScreen(preset));
}

export function withEffect(
  a: Appearance,
  effect: Effect,
  patch: Partial<EffectSetting>,
): Appearance {
  return withScreen(a, (screen) => withEffectSetting(screen, effect, patch));
}
