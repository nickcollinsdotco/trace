import { useSyncExternalStore } from "react";
import { CHANGELOG, type Change, changesSince } from "../../changelog";

/**
 * Whether this build's changes have been looked at yet.
 *
 * One remembered version, read by three places: the status bar's
 * "updated · what's new", the boot sequence's patch line, and About, which
 * marks it seen by showing the changes. A store rather than a read in each,
 * so seeing them on About quietens the status bar at once.
 */

const KEY = "trace.whats-new.seen";
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The changes not yet looked at, newest first. Empty once seen. */
export function unseenChanges(): Change[] {
  return changesSince(CHANGELOG, read());
}

export function markWhatsNewSeen() {
  // The gallery shares this storage with the app's own window: looking at
  // the About scenario there must not quieten the app's "what's new".
  if (typeof location !== "undefined" && location.hash.startsWith("#gallery")) return;
  const now = CHANGELOG[0]?.version;
  if (!now || read() === now) return;
  try {
    localStorage.setItem(KEY, now);
  } catch {
    // Not worth surfacing: the status bar simply offers it again next time.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The version that has changes waiting, or null when there are none. */
export function useUnseenVersion(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (unseenChanges().length > 0 ? (CHANGELOG[0]?.version ?? null) : null),
    () => null,
  );
}
