import { useEffect, useState } from "react";
import {
  type Appearance,
  AppearanceContext,
  type AppearanceControl,
  loadAppearance,
  saveAppearance,
  withAxis,
  withTheme,
} from "../design/appearance";
import { applyTheme, THEMES, themeForKey } from "../design/theme";
import { AboutScreen } from "../features/about/AboutScreen";
import { AppearanceScreen } from "../features/appearance/AppearanceScreen";
import { CaptureScreen } from "../features/capture/CaptureScreen";
import { FirstRunScreen } from "../features/firstrun/FirstRunScreen";
import { LibraryScreen } from "../features/library/LibraryScreen";
import { ModelsScreen } from "../features/models/ModelsScreen";
import { NoteScreen } from "../features/note/NoteScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { hasBackend, ipc } from "../lib/ipc";
import { Shell } from "./Shell";
import type { Page } from "./Sidebar";

/**
 * Route state. Deliberately a union rather than a router library — TRACE has
 * a handful of screens, and adding react-router here would be exactly the
 * premature infrastructure docs/08-CLAUDE-AUDIT-PROMPT.md warns against.
 */
type Route =
  | { name: "library"; search?: string }
  | { name: "capture" }
  | { name: "note"; path: string }
  | { name: "models" }
  | { name: "appearance" }
  | { name: "settings" }
  | { name: "about" };

export function App() {
  const [route, setRoute] = useState<Route>({ name: "library" });
  // Bumped to force the library to re-read from disk after a meeting is saved.
  const [libraryKey, setLibraryKey] = useState(0);

  const appearance = useAppearance();
  const [ready, setReady] = useModelReady();

  /*
   * First run owns the whole window rather than a corner of the shell.
   * There is nothing else to do until the model is present — capture works
   * without it, but produces no transcript, which is not what anyone wants
   * from their first meeting.
   */
  if (ready === false) {
    return <FirstRunScreen onReady={() => setReady(true)} />;
  }

  const toLibrary = (search?: string) => {
    setLibraryKey((k) => k + 1);
    setRoute(search === undefined ? { name: "library" } : { name: "library", search });
  };

  const navigate = (page: Page) => {
    if (page === "library") toLibrary();
    // Every other page is a route of the same name with no parameters.
    else setRoute({ name: page } as Route);
  };

  return (
    <AppearanceContext.Provider value={appearance}>
      <Shell
        current={route.name === "note" ? null : route.name}
        onNavigate={navigate}
        openNote={route.name === "note" ? route.path : null}
        onOpenNote={(path) => setRoute({ name: "note", path })}
      >
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
            onBack={() => toLibrary()}
            // Clicking a tag goes back to the library with it already searched.
            onSearchTag={(tag) => toLibrary(`tag:${tag}`)}
          />
        )}

        {route.name === "models" && <ModelsScreen />}
        {route.name === "appearance" && <AppearanceScreen />}
        {route.name === "settings" && <SettingsScreen />}
        {route.name === "about" && <AboutScreen />}
      </Shell>
    </AppearanceContext.Provider>
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
 * Applies the chosen look, and lets the theme be changed from the keyboard.
 *
 * The keybinds are the point, not a convenience. Themes cannot be chosen from
 * a screenshot — the failure modes only show up around minute forty of a real
 * meeting — so switching has to be possible *during* one, in the app, without
 * a restart. See docs/11-PLAN.md, Phase C. The Appearance page is the same
 * control with the options visible.
 */
function useAppearance(): AppearanceControl {
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);

  useEffect(() => {
    applyTheme(appearance.theme, document.documentElement, appearance.overrides);
    saveAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Number keys pick a look directly — but never while the notes field
      // has focus, where they are just digits the user is typing.
      const picked = themeForKey(e.key, e.target, e.ctrlKey || e.metaKey || e.altKey);
      if (picked) {
        e.preventDefault();
        setAppearance((a) => ({ ...a, theme: picked }));
        return;
      }

      if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== "t") return;
      e.preventDefault();
      setAppearance((a) => ({
        ...a,
        theme: THEMES[(THEMES.indexOf(a.theme) + 1) % THEMES.length] ?? "terminal",
      }));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return {
    appearance,
    setTheme: (theme) => setAppearance((a) => withTheme(a, theme)),
    setAxis: (axis, value) => setAppearance((a) => withAxis(a, axis, value)),
    reset: () => setAppearance((a) => ({ ...a, overrides: {} })),
  };
}
