import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Appearance,
  AppearanceContext,
  type AppearanceControl,
  currentAdjustments,
  currentScreen,
  loadAppearance,
  saveAppearance,
  withAxis,
  withEffect,
  withFamily,
  withPreset,
  withReset,
  withTheme,
} from "../design/appearance";
import { applyScreen } from "../design/screen";
import { applyTheme, THEMES, themeForKey } from "../design/theme";
import { AboutScreen } from "../features/about/AboutScreen";
import { AppearanceScreen } from "../features/appearance/AppearanceScreen";
import { CaptureScreen } from "../features/capture/CaptureScreen";
import { FirstRunScreen } from "../features/firstrun/FirstRunScreen";
import { Boot, FoundFile, Rain, useSecrets, useWordmarkClicks } from "../features/fun/Eggs";
import { FunContext, type FunControl, loadFun, saveFun } from "../features/fun/fun";
import { LibraryScreen } from "../features/library/LibraryScreen";
import { useMiniShortcut } from "../features/mini/shortcut";
import { ModelsScreen } from "../features/models/ModelsScreen";
import { NoteScreen } from "../features/note/NoteScreen";
import { buildCommands } from "../features/palette/commands";
import { Palette } from "../features/palette/Palette";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { hasBackend, ipc, isDesktop, onCaptureChanged, onOpenNote } from "../lib/ipc";
import { Shell } from "./Shell";
import type { Page } from "./Sidebar";

/**
 * Route state. Deliberately a union rather than a router library — TRACE has
 * a handful of screens, and adding react-router here would be exactly the
 * premature infrastructure docs/08-CLAUDE-AUDIT-PROMPT.md warns against.
 */
type Route =
  | { name: "library"; search?: string }
  /** `stop` asks the screen to stop the meeting, once per distinct value. */
  | { name: "capture"; stop?: number }
  | { name: "note"; path: string }
  | { name: "models" }
  | { name: "appearance" }
  | { name: "settings" }
  | { name: "about"; focus?: "whats-new" };

export function App() {
  const [route, setRoute] = useState<Route>({ name: "library" });
  // Bumped to force the library to re-read from disk after a meeting is saved.
  const [libraryKey, setLibraryKey] = useState(0);

  const appearance = useAppearance();
  const [ready, setReady] = useModelReady();
  const palette = usePalette();
  const captureKey = useOtherWindow((path) => setRoute({ name: "note", path }));
  const fun = useFunMode();
  const [egg, setEgg] = useEggs(fun.on);
  const miniShortcut = useMiniShortcut();

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

  const commands = buildCommands({
    navigate,
    searchLibrary: (q) => toLibrary(q),
    // Through the capture screen, not straight to the backend: the screen
    // flushes the notes typed in the last half-second before it stops.
    stopMeeting: () => setRoute({ name: "capture", stop: Date.now() }),
    openMini: () => void ipc.openMini().catch(() => {}),
    resetMini: () => void ipc.resetMini().catch(() => {}),
    miniShortcut,
    openGallery: () => {
      if (isDesktop()) void ipc.openGallery().catch(() => {});
      else location.hash = "gallery";
    },
    recording: palette.recording,
    appearance,
    fun,
    openChangelog: () => setRoute({ name: "about", focus: "whats-new" }),
  });

  return (
    <AppearanceContext.Provider value={appearance}>
      <FunContext.Provider value={fun}>
        <Shell
          current={route.name === "note" ? null : route.name}
          onNavigate={navigate}
          openNote={route.name === "note" ? route.path : null}
          onOpenNote={(path) => setRoute({ name: "note", path })}
          onWhatsNew={() => setRoute({ name: "about", focus: "whats-new" })}
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
              key={captureKey}
              stopRequest={route.stop}
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
              onRenamed={(path) => setRoute({ name: "note", path })}
            />
          )}

          {route.name === "models" && <ModelsScreen />}
          {route.name === "appearance" && <AppearanceScreen />}
          {route.name === "settings" && <SettingsScreen />}
          {route.name === "about" && <AboutScreen key={route.focus} focus={route.focus} />}

          {palette.open && (
            <Palette
              commands={commands}
              onOpenNote={(path) => setRoute({ name: "note", path })}
              onSearchLibrary={(q) => toLibrary(q)}
              onClose={palette.close}
              appearance={appearance}
            />
          )}

          {egg === "boot" && <Boot onDone={() => setEgg(null)} />}
          {egg === "rain" && <Rain onDone={() => setEgg(null)} />}
          {egg === "found" && <FoundFile onClose={() => setEgg(null)} />}
        </Shell>
      </FunContext.Provider>
    </AppearanceContext.Provider>
  );
}

/**
 * What the mini window does that this window has to hear about.
 *
 * A note to open: stopping there flashes this window in the taskbar and
 * leaves the note waiting, so coming back lands on it (docs/13 Q26). And a
 * meeting started or stopped there: the recording screen read the state once
 * when it mounted, so it is mounted afresh to read it again.
 */
function useOtherWindow(openNote: (path: string) => void): number {
  const [captureKey, setCaptureKey] = useState(0);
  const open = useRef(openNote);
  open.current = openNote;

  useEffect(() => {
    if (!hasBackend()) return;
    const unlisten: Array<() => void> = [];
    void onOpenNote((path) => open.current(path)).then((u) => unlisten.push(u));
    void onCaptureChanged(() => setCaptureKey((k) => k + 1)).then((u) => unlisten.push(u));
    return () => {
      for (const u of unlisten) u();
    };
  }, []);

  return captureKey;
}

/** Fun mode, remembered between launches. */
function useFunMode(): FunControl {
  const [on, setOn] = useState(loadFun);
  return useMemo(
    () => ({
      on,
      setOn: (next: boolean) => {
        saveFun(next);
        setOn(next);
      },
    }),
    [on],
  );
}

type Egg = "boot" | "rain" | "found";

/**
 * The big easter eggs, and when they may play.
 *
 * Never over a meeting being recorded (docs/13 Q6): the recording screen is
 * where the user works, and it may be on a shared screen. The boot sequence
 * plays at launch in Fun mode; the rest answer their secrets in any mode.
 */
function useEggs(funOn: boolean): [Egg | null, (egg: Egg | null) => void] {
  const [egg, setEgg] = useState<Egg | null>(null);

  const play = (next: Egg) => {
    if (!hasBackend()) {
      setEgg(next);
      return;
    }
    void ipc
      .captureStatus()
      .then((s) => {
        if (s === null) setEgg(next);
      })
      .catch(() => {});
  };

  // Launch only: turning Fun mode on later is greeted by the narrator.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, at launch
  useEffect(() => {
    if (funOn) play("boot");
  }, []);

  useSecrets((secret) => play(secret === "konami" ? "rain" : "boot"));
  useWordmarkClicks(() => play("found"));

  return [egg, setEgg];
}

/**
 * Ctrl+K (Cmd+K) opens the palette from anywhere, text fields included —
 * the modifier means it can never be typing. Pressed again, it closes.
 *
 * Whether a meeting is recording is asked as it opens, so the palette
 * offers Stop or Start to match, without polling while it is shut.
 */
function usePalette(): { open: boolean; recording: boolean; close: () => void } {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      setOpen((o) => !o);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || !hasBackend()) return;
    void ipc
      .captureStatus()
      .then((s) => setRecording(s !== null))
      .catch(() => {});
  }, [open]);

  const close = useMemo(() => () => setOpen(false), []);
  return { open, recording, close };
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
    applyTheme(appearance.theme, document.documentElement, currentAdjustments(appearance));
    applyScreen(currentScreen(appearance), document.documentElement);
    saveAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Number keys pick a look directly — but never while the notes field
      // has focus, where they are just digits the user is typing.
      const picked = themeForKey(e.key, e.target, e.ctrlKey || e.metaKey || e.altKey);
      if (picked) {
        e.preventDefault();
        setAppearance((a) => withTheme(a, picked));
        return;
      }

      if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== "t") return;
      e.preventDefault();
      setAppearance((a) =>
        withTheme(a, THEMES[(THEMES.indexOf(a.theme) + 1) % THEMES.length] ?? "terminal"),
      );
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return {
    appearance,
    setTheme: (theme) => setAppearance((a) => withTheme(a, theme)),
    setFamily: (family) => setAppearance((a) => withFamily(a, family)),
    setPreset: (preset) => setAppearance((a) => withPreset(a, preset)),
    setEffect: (effect, patch) => setAppearance((a) => withEffect(a, effect, patch)),
    setAxis: (axis, value) => setAppearance((a) => withAxis(a, axis, value)),
    reset: () => setAppearance(withReset),
    restore: (a) => setAppearance(a),
  };
}
