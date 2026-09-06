import { useEffect, useState } from "react";
import { applyTheme, loadTheme, saveTheme, THEMES, type Theme, themeForKey } from "../design/theme";
import { CaptureScreen } from "../features/capture/CaptureScreen";
import { FirstRunScreen } from "../features/firstrun/FirstRunScreen";
import { LibraryScreen } from "../features/library/LibraryScreen";
import { NoteScreen } from "../features/note/NoteScreen";
import { hasBackend, ipc } from "../lib/ipc";
import { ModelGate } from "./ModelGate";
import { Wordmark } from "./Wordmark";

/**
 * Route state. Deliberately a union rather than a router library — TRACE has
 * three screens, and adding react-router here would be exactly the premature
 * infrastructure docs/08-CLAUDE-AUDIT-PROMPT.md warns against.
 */
type Route =
  | { name: "library"; search?: string }
  | { name: "capture" }
  | { name: "note"; path: string };

export function App() {
  const [route, setRoute] = useState<Route>({ name: "library" });
  // Bumped to force the library to re-read from disk after a meeting is saved.
  const [libraryKey, setLibraryKey] = useState(0);

  useTheme();
  const [ready, setReady] = useModelReady();

  /*
   * First run owns the whole window rather than a corner of the header.
   * There is nothing else to do until the model is present — capture works
   * without it, but produces no transcript, which is not what anyone wants
   * from their first meeting.
   */
  if (ready === false) {
    return <FirstRunScreen onReady={() => setReady(true)} />;
  }

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <header className="flex shrink-0 items-center gap-4 border-b border-line px-5 py-3">
        <button
          type="button"
          onClick={() => setRoute({ name: "library" })}
          className="rounded-xs transition-opacity duration-120 hover:opacity-80"
          aria-label="TRACE — back to meetings"
        >
          <Wordmark />
        </button>
        <span aria-hidden className="trace-rule" />
        <ModelGate />
      </header>

      <main className="min-h-0 flex-1">
        {route.name === "library" && (
          <LibraryScreen
            key={libraryKey}
            initialSearch={route.search ?? ""}
            onNewMeeting={() => setRoute({ name: "capture" })}
            onOpenNote={(path) => setRoute({ name: "note", path })}
          />
        )}

        {route.name === "capture" && (
          <CaptureScreen
            onFinish={(notePath) => {
              setLibraryKey((k) => k + 1);
              setRoute(notePath ? { name: "note", path: notePath } : { name: "library" });
            }}
          />
        )}

        {route.name === "note" && (
          <NoteScreen
            path={route.path}
            onBack={() => {
              setLibraryKey((k) => k + 1);
              setRoute({ name: "library" });
            }}
            // Clicking a tag goes back to the library with it already searched.
            onSearchTag={(tag) => {
              setLibraryKey((k) => k + 1);
              setRoute({ name: "library", search: `tag:${tag}` });
            }}
          />
        )}
      </main>
    </div>
  );
}

/**
 * Whether the speech model is installed.
 *
 * `null` while unknown, so the app does not flash the first-run report at
 * someone who already has the model — the check is a filesystem stat, so the
 * unknown window is a frame or two.
 */
function useModelReady(): [boolean | null, (v: boolean) => void] {
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!hasBackend()) {
      setReady(true);
      return;
    }
    void ipc
      .modelStatus()
      .then((s) => setReady(s.installed))
      // A failed check is not a reason to block the app: capture still works
      // without a transcript, and the header reports the model state anyway.
      .catch(() => setReady(true));
  }, []);

  return [ready, setReady];
}

/**
 * Applies the chosen theme, and lets it be cycled with Ctrl+Shift+T.
 *
 * The keybind is the point, not a convenience. Themes cannot be chosen from a
 * screenshot — the failure modes only show up around minute forty of a real
 * meeting — so switching has to be possible *during* one, in the app, without
 * a restart. See docs/11-PLAN.md, Phase C.
 */
function useTheme() {
  const [theme, setTheme] = useState<Theme>(loadTheme);

  useEffect(() => {
    applyTheme(theme, document.documentElement);
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Number keys pick a look directly — but never while the notes field
      // has focus, where they are just digits the user is typing.
      const picked = themeForKey(e.key, e.target, e.ctrlKey || e.metaKey || e.altKey);
      if (picked) {
        e.preventDefault();
        setTheme(picked);
        return;
      }

      if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== "t") return;
      e.preventDefault();
      setTheme((t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length] ?? "terminal");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
