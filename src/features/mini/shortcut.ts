import { useEffect, useSyncExternalStore } from "react";
import { hasBackend, ipc, type Settings } from "../../lib/ipc";

/**
 * The mini window's shortcut, for the hints that name it: the sidebar, the
 * recording screen, the palette, the mini window's own menu.
 *
 * One store rather than a fetch in each, so changing it in Settings changes
 * every hint at once — and a shortcut another app holds is never promised,
 * because a hint that does nothing is worse than none.
 */

const DEFAULT = "Ctrl+Shift+Alt+M";

let known: { shortcut: string; taken: boolean } | null = null;
let asked = false;
const listeners = new Set<() => void>();

/** Settings came back from the backend: every hint follows them. */
export function publishShortcut(settings: Settings) {
  known = { shortcut: settings.miniShortcut, taken: settings.miniShortcutTaken };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string | null {
  if (!known) return hasBackend() ? null : DEFAULT;
  return known.taken || !known.shortcut ? null : known.shortcut;
}

/** The working shortcut, or null when there is none to promise. */
export function useMiniShortcut(): string | null {
  useEffect(() => {
    if (asked || !hasBackend()) return;
    asked = true;
    void ipc
      .getSettings()
      .then(publishShortcut)
      .catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** For tests: forget what was learned. */
export function resetShortcutStore() {
  known = null;
  asked = false;
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "OS"]);

/**
 * A key press as a shortcut, written as people read them and as the backend
 * parses them — "Ctrl+Shift+Alt+M". Null while only modifiers are down, so
 * a recorder can wait for the real key.
 *
 * Built from `code`, not `key`: with Alt or Shift held, `key` is whatever
 * character the layout makes of it, which is not the key that was pressed.
 */
export function shortcutFromEvent(e: {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = keyName(e.code);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push("Super");
  parts.push(key);
  return parts.join("+");
}

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  const named: Record<string, string> = {
    Space: "Space",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };
  return named[code] ?? null;
}

/** Shown in place of "Super", which nobody on Windows calls it. */
export function shortcutLabel(shortcut: string): string {
  return shortcut.replace(/\bSuper\b/, "Win");
}

/** Whether the backend would accept it: Shift alone is typing, not a shortcut. */
export function hasRealModifier(shortcut: string): boolean {
  return /\b(Ctrl|Alt|Super)\+/.test(shortcut);
}
