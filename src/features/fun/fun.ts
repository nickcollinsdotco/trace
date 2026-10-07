import { createContext, useContext } from "react";

/**
 * Fun mode (CONTEXT.md): app-wide, off, and hidden for now — no switch in
 * Appearance or the palette — until there is louder play worth putting
 * behind it. The boot sequence it used to carry plays at every launch.
 *
 * On (only for anyone who switched it on before), the library's signal line
 * signs off with a boot quote. The
 * secrets — the Konami code, typing `trace`, the wordmark, the hidden palette
 * commands — answer whether it is on or not: they are found by doing
 * something deliberate, and finding one should not depend on a setting nobody
 * knew to turn on.
 *
 * The narrator is on unless turned off, jokes and all. It was Fun mode's at
 * first, and so seen by almost nobody; then plain without it, which was a
 * narrator with the reason for having one taken out.
 */
const KEY = "trace.fun";
const NARRATOR_KEY = "trace.narrator";

export function loadFun(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function saveFun(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "on");
    else localStorage.removeItem(KEY);
  } catch {
    // Not worth surfacing — the choice simply does not persist.
  }
}

/** Stored only when turned off, so on is the default. */
export function loadNarrator(): boolean {
  try {
    return localStorage.getItem(NARRATOR_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveNarrator(on: boolean): void {
  try {
    if (on) localStorage.removeItem(NARRATOR_KEY);
    else localStorage.setItem(NARRATOR_KEY, "off");
  } catch {
    // As above.
  }
}

export interface FunControl {
  on: boolean;
  setOn: (on: boolean) => void;
  /** The narrator in the status bar, on by default and apart from Fun mode. */
  narrator: boolean;
  setNarrator: (on: boolean) => void;
}

/*
 * Off outside a provider: the narrator belongs to the main window's status
 * bar, and nothing else should start talking because it forgot one.
 */
export const FunContext = createContext<FunControl>({
  on: false,
  setOn: () => {},
  narrator: false,
  setNarrator: () => {},
});

export function useFun(): FunControl {
  return useContext(FunContext);
}
