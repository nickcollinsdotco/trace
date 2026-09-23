import { createContext, useContext } from "react";
import {
  CASES,
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
  type Theme,
  TYPES,
} from "./theme";

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
}

const OVERRIDES_KEY = "trace.appearance.overrides";

export function loadAppearance(): Appearance {
  return { theme: loadTheme(), overrides: loadOverrides() };
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
  } catch {
    // Not worth surfacing — the choice simply does not persist.
  }
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

export function withTheme(a: Appearance, theme: string): Appearance {
  return isTheme(theme) ? { ...a, theme } : a;
}
