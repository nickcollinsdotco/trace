import { createContext, useContext } from "react";

/**
 * Fun mode (CONTEXT.md): app-wide, off until asked for.
 *
 * On, the narrator takes the status bar's spare room and the boot sequence
 * plays at launch. The secrets — the Konami code, typing `trace`, the
 * wordmark, the hidden palette commands — answer whether it is on or not:
 * they are found by doing something deliberate, and finding one should not
 * depend on a setting nobody knew to turn on.
 */
const KEY = "trace.fun";

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

export interface FunControl {
  on: boolean;
  setOn: (on: boolean) => void;
}

export const FunContext = createContext<FunControl>({ on: false, setOn: () => {} });

export function useFun(): FunControl {
  return useContext(FunContext);
}
