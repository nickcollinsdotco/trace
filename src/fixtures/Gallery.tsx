/**
 * The screen gallery — Ctrl+Shift+G, in a window of its own.
 *
 * Every screen, in every state worth seeing, without recording anything, and
 * under any theme. This is the tool that makes the visual pass possible: the
 * reason it kept being deferred is that looking at a screen used to cost a
 * meeting. It ships in every build, so themes can be judged in the installed
 * app rather than only in dev.
 *
 * Two rules it follows:
 *
 *   1. It renders the REAL screens. No copies, no simplified versions. A
 *      harness that drifts from the product is worse than none, because it
 *      lies with authority.
 *   2. The harness chrome is deliberately NOT themed. Only the preview pane
 *      carries `data-theme`, so you can always tell the product from the
 *      tooling.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Shell } from "../app/Shell";
import type { Page } from "../app/Sidebar";
import { type ConfirmOptions, useConfirm } from "../components/ui/Confirm";
import {
  type Appearance,
  AppearanceContext,
  type AppearanceControl,
  currentAdjustments,
  currentScreen,
  defaultFamilies,
  useAppearanceControl,
  withAxis,
  withEffect,
  withFamily,
  withPreset,
  withReset,
  withTheme,
} from "../design/appearance";
import { applyScreen, PRESET_NOTES, PRESETS, presetOf } from "../design/screen";
import {
  applyTheme,
  CASE_NOTES,
  CASES,
  FRAMES,
  isTheme,
  MONO_NOTES,
  MONOS,
  THEME_FRAME,
  THEME_NOTES,
  THEME_TYPE,
  THEMES,
  type Theme,
  TYPE_NOTES,
  TYPES,
  themeForKey,
} from "../design/theme";
import { AboutScreen } from "../features/about/AboutScreen";
import { AppearanceScreen } from "../features/appearance/AppearanceScreen";
import { CaptureScreen } from "../features/capture/CaptureScreen";
import { FirstRunScreen } from "../features/firstrun/FirstRunScreen";
import { Boot, FoundFile } from "../features/fun/Eggs";
import { FunContext } from "../features/fun/fun";
import { LibraryScreen } from "../features/library/LibraryScreen";
import { MiniWindow } from "../features/mini/MiniWindow";
import { ModelsScreen } from "../features/models/ModelsScreen";
import { NoteScreen } from "../features/note/NoteScreen";
import { buildCommands } from "../features/palette/commands";
import { Palette } from "../features/palette/Palette";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { installFakeBackend } from "../lib/ipc";
import { makeBackend } from "./backend";
import { SCENARIOS, type Scenario, scenarioById } from "./scenarios";

/**
 * Widths worth checking. The app is a desktop window, not a phone. 860 and
 * 1000 sit either side of the sidebar's breakpoint (Shell.tsx); 1200 is the
 * window the app opens at.
 */
const WIDTHS = [
  { id: "860", px: 860 },
  { id: "1000", px: 1000 },
  { id: "1200", px: 1200 },
  { id: "full", px: 0 },
] as const;

/*
 * The Stage 0 layout prototypes (layout.css, docs/13-DESIGN-UPGRADES.md).
 * Each is judged here on real screens, one value is kept, and the rest of
 * these lists are deleted.
 */
const ALIGNS = [
  { id: "focus", note: "Pages start at the top; a page with one job sits centred." },
  { id: "fit", note: "Anything short enough to fit is centred; longer pages start at the top." },
  { id: "top", note: "Everything starts at the top." },
] as const;
const COLUMNS = ["42rem", "48rem", "52rem", "56rem"] as const;
const READING = ["42rem", "none"] as const;

/**
 * The gallery's own theme, apart from the app's.
 *
 * The gallery runs beside the app now, and they share storage. Saving under
 * the app's key would quietly change the theme the app opens with next time.
 */
const THEME_KEY = "trace.gallery.theme";

function loadGalleryTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // The default is a fine answer.
  }
  return "terminal";
}

export function Gallery() {
  const [scenarioId, setScenarioId] = useState(
    () => location.hash.split("/")[1] ?? SCENARIOS[0]?.id ?? "",
  );
  // The same shape the app keeps, changed by the same pure functions, so the
  // gallery cannot disagree with the app about what a switch does.
  const [look, setLook] = useState<Appearance>(() => ({
    theme: loadGalleryTheme(),
    adjustments: {},
    families: defaultFamilies(),
  }));
  const [width, setWidth] = useState<(typeof WIDTHS)[number]["id"]>("1200");
  const [align, setAlign] = useState<(typeof ALIGNS)[number]["id"]>("focus");
  const [column, setColumn] = useState<(typeof COLUMNS)[number]>("52rem");
  const [reading, setReading] = useState<(typeof READING)[number]>("42rem");
  const preview = useRef<HTMLDivElement>(null);

  const scenario = scenarioById(scenarioId) ?? SCENARIOS[0];
  const { theme } = look;
  const overrides = currentAdjustments(look);
  const screen = currentScreen(look);

  /*
   * Installed during render, deliberately.
   *
   * The screens call the backend from their very first effect, so the stand-in
   * has to be in place before they mount — which means before this function
   * returns. `useMemo` is the earliest correct hook for that, and installing
   * is idempotent, so StrictMode's double render is harmless.
   */
  const backend = useMemo(() => {
    const fake = scenario ? makeBackend(scenario.state) : null;
    installFakeBackend(fake);
    return fake;
  }, [scenario]);

  /*
   * Reinstalled on mount, not only removed on unmount, and in a *layout*
   * effect.
   *
   * StrictMode mounts, unmounts and remounts in development. With only an
   * unmount cleanup, that removed the backend the memo had installed, the memo
   * did not run again, and the first scenario opened on "no backend" every
   * time the gallery loaded. A plain effect is no fix: the screens' own
   * effects run before their parent's, so they would fetch in the gap between
   * this cleanup and the reinstall. Layout effects all run before any plain
   * effect, which closes the gap on both a remount and a scenario change.
   */
  useLayoutEffect(() => {
    installFakeBackend(backend);
    return () => installFakeBackend(null);
  }, [backend]);

  /*
   * The Appearance page, driven by the gallery's own controls. Picking a card
   * in the preview re-themes the preview, exactly as it re-themes the app.
   */
  const appearance: AppearanceControl = {
    appearance: look,
    setTheme: (t) => setLook((a) => withTheme(a, t)),
    setFamily: (f) => setLook((a) => withFamily(a, f)),
    setPreset: (p) => setLook((a) => withPreset(a, p)),
    setEffect: (e, patch) => setLook((a) => withEffect(a, e, patch)),
    setAxis: (axis, value) => setLook((a) => withAxis(a, axis, value)),
    reset: () => setLook(withReset),
    restore: (a) => setLook(a),
  };
  const setAxis = appearance.setAxis;

  useEffect(() => {
    if (preview.current) {
      applyTheme(theme, preview.current, overrides);
      applyScreen(screen, preview.current);
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Not worth surfacing.
    }
  }, [theme, overrides, screen]);

  useEffect(() => {
    if (scenario) location.hash = `gallery/${scenario.id}`;
  }, [scenario]);

  // Number keys flip between themes. Comparing is the whole job here, and a
  // modifier is friction when you are doing it fifty times.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const next = themeForKey(e.key, e.target, e.ctrlKey || e.metaKey || e.altKey);
      if (!next) return;
      e.preventDefault();
      setLook((a) => withTheme(a, next));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groups = [...new Set(SCENARIOS.map((s) => s.group))];
  const px = WIDTHS.find((w) => w.id === width)?.px ?? 0;

  return (
    <div className="flex h-full bg-[#17171a] text-[#d8d8dc]">
      <nav
        aria-label="Scenarios"
        className="flex w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-white/10 p-4"
      >
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">
            TRACE gallery
          </p>
          <p className="mt-1 text-[11px] leading-snug text-white/30">
            Real screens, invented data. Nothing here touches your meetings.
          </p>
        </div>

        {groups.map((group) => (
          <section key={group} className="flex flex-col gap-0.5">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">
              {group}
            </p>
            {SCENARIOS.filter((s) => s.group === group).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScenarioId(s.id)}
                className={`rounded px-2 py-1.5 text-left text-[12px] transition-colors ${
                  s.id === scenario?.id
                    ? "bg-white/10 text-white"
                    : "text-white/55 hover:bg-white/5 hover:text-white/85"
                }`}
              >
                {s.name}
              </button>
            ))}
          </section>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-col gap-2 border-b border-white/10 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Switcher
              label="Theme"
              options={THEMES.map((t, i) => ({
                id: t,
                // The key that picks it: 1–9, then 0.
                label: `${(i + 1) % 10} ${t}`,
                title: THEME_NOTES[t],
              }))}
              value={theme}
              onChange={(v) => appearance.setTheme(v as Theme)}
            />
            {/* Presets only: the per-effect sliders are on the Appearance
                page, which the gallery renders as the Appearance scenario. */}
            <Switcher
              label="Screen"
              options={[
                ...PRESETS.map((p) => ({ id: p, label: p, title: PRESET_NOTES[p] })),
                ...(presetOf(screen) ? [] : [{ id: "custom", label: "custom" }]),
              ]}
              value={presetOf(screen) ?? "custom"}
              onChange={(v) => {
                if (v !== "custom") appearance.setPreset(v as (typeof PRESETS)[number]);
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Switcher
              label="Frame"
              options={[
                { id: "auto", label: `auto (${THEME_FRAME[theme]})` },
                ...FRAMES.map((f) => ({ id: f, label: f })),
              ]}
              value={overrides.frame ?? "auto"}
              onChange={(v) => setAxis("frame", v === "auto" ? undefined : v)}
            />
            <Switcher
              label="Type"
              options={[
                { id: "auto", label: `auto (${THEME_TYPE[theme].role})` },
                ...TYPES.map((t) => ({ id: t, label: t, title: TYPE_NOTES[t] })),
              ]}
              value={overrides.role ?? "auto"}
              onChange={(v) => setAxis("role", v === "auto" ? undefined : v)}
            />
            <Switcher
              label="Mono"
              options={[
                { id: "auto", label: `auto (${THEME_TYPE[theme].mono})` },
                ...MONOS.map((m) => ({ id: m, label: m, title: MONO_NOTES[m] })),
              ]}
              value={overrides.mono ?? "auto"}
              onChange={(v) => setAxis("mono", v === "auto" ? undefined : v)}
            />
            <Switcher
              label="Case"
              options={[
                { id: "auto", label: `auto (${THEME_TYPE[theme].case})` },
                ...CASES.map((c) => ({ id: c, label: c, title: CASE_NOTES[c] })),
              ]}
              value={overrides.case ?? "auto"}
              onChange={(v) => setAxis("case", v === "auto" ? undefined : v)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Switcher
              label="Width"
              options={WIDTHS.map((w) => ({ id: w.id, label: w.id }))}
              value={width}
              onChange={(v) => setWidth(v as typeof width)}
            />
            <Switcher
              label="Align"
              options={ALIGNS.map((a) => ({ id: a.id, label: a.id, title: a.note }))}
              value={align}
              onChange={(v) => setAlign(v as typeof align)}
            />
            <Switcher
              label="Column"
              options={COLUMNS.map((c) => ({ id: c, label: c }))}
              value={column}
              onChange={(v) => setColumn(v as typeof column)}
            />
            <Switcher
              label="Reading"
              options={READING.map((r) => ({ id: r, label: r }))}
              value={reading}
              onChange={(v) => setReading(v as typeof reading)}
            />
            {scenario && (
              <p className="ml-auto max-w-md text-right text-[11px] leading-snug text-white/40">
                {scenario.note}
              </p>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-6">
          <div
            ref={preview}
            data-align={align === "focus" ? undefined : align}
            style={
              {
                width: px || undefined,
                "--column": column,
                "--reading-measure": reading,
              } as React.CSSProperties
            }
            // The transform makes the pane the frame for anything fixed inside
            // it, so a full-window moment like the boot sequence fills the
            // preview, as it fills the app's window, instead of the gallery.
            className="mx-auto flex h-full min-h-[560px] transform-[translateZ(0)] flex-col overflow-hidden rounded-md border border-white/10 bg-surface-0 shadow-2xl"
          >
            {/*
              Keyed by scenario so switching genuinely remounts. Without this a
              screen would keep the state it had built up under the previous
              fixture, and show something that has never existed.
            */}
            {scenario && (
              <AppearanceContext.Provider value={appearance}>
                <Preview key={scenario.id} scenario={scenario} />
              </AppearanceContext.Provider>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The real app shell around the scenario's screen. */
function Preview({ scenario }: { scenario: Scenario }) {
  // First run owns the whole window, with no shell around it.
  if (scenario.screen === "firstrun") {
    return <FirstRunScreen onReady={() => {}} />;
  }

  // The mini window is a window of its own, so it is shown at its own size
  // on an empty desk rather than inside the app's shell.
  if (scenario.screen === "mini") {
    return (
      <div className="flex h-full items-center justify-center bg-surface-0">
        <div
          // At least the usual width, and wider when the content needs it,
          // as the real window grows.
          className="w-max overflow-hidden rounded-md border border-line-strong shadow-(--elevation-overlay)"
          style={{ minWidth: 360, minHeight: 56 }}
        >
          <MiniWindow
            {...(scenario.miniSaved
              ? { initial: { kind: "saved" as const, notePath: "fixture.md" } }
              : {})}
            initialMenu={scenario.miniMenu ?? false}
            initialDetails={scenario.miniDetails ?? false}
            offer={scenario.miniOffer ?? false}
          />
        </div>
      </div>
    );
  }

  const noop = () => {};
  const current: Page | null = scenario.screen === "note" ? null : scenario.screen;
  return (
    <FunContext.Provider value={{ on: scenario.fun !== undefined, setOn: noop }}>
      <Shell
        current={current}
        onNavigate={noop}
        // As the app passes it, so a note scenario is not shown a toast about
        // itself that the real app would hold back.
        openNote={scenario.screen === "note" ? (scenario.notePath ?? null) : null}
        onOpenNote={noop}
      >
        {scenario.screen === "library" && (
          <LibraryScreen
            initialSearch={scenario.search ?? ""}
            onNewMeeting={noop}
            onOpenNote={noop}
          />
        )}
        {scenario.screen === "capture" && (
          <CaptureScreen onFinish={noop} initialScopeView={scenario.scopeView ?? false} />
        )}
        {scenario.screen === "note" && <NoteScreen path={scenario.notePath ?? ""} onBack={noop} />}
        {scenario.screen === "models" && <ModelsScreen />}
        {scenario.screen === "appearance" && <AppearanceScreen />}
        {scenario.screen === "settings" && <SettingsScreen />}
        {scenario.screen === "about" && <AboutScreen />}
        {scenario.dialog && <AskOnMount options={scenario.dialog} />}
        {scenario.palette !== undefined && <PalettePreview query={scenario.palette} />}
        {scenario.fun?.egg === "boot" && <Boot onDone={noop} />}
        {scenario.fun?.egg === "found" && <FoundFile onClose={noop} />}
      </Shell>
    </FunContext.Provider>
  );
}

/**
 * The palette as the app opens it, over the scenario's screen. Its commands
 * do nothing here except the appearance ones, which re-theme the preview.
 */
function PalettePreview({ query }: { query: string }) {
  const appearance = useAppearanceControl();
  const noop = () => {};
  const commands = buildCommands({
    navigate: noop,
    searchLibrary: noop,
    stopMeeting: noop,
    openGallery: noop,
    recording: false,
    appearance,
  });
  return (
    <Palette
      commands={commands}
      initialQuery={query}
      onOpenNote={noop}
      onSearchLibrary={noop}
      onClose={noop}
      appearance={appearance}
    />
  );
}

/** Puts a scenario's question on screen, as the screen itself would ask it. */
function AskOnMount({ options }: { options: ConfirmOptions }) {
  const confirm = useConfirm();
  useEffect(() => {
    void confirm(options);
  }, [confirm, options]);
  return null;
}

function Switcher({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; label: string; title?: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">
        {label}
      </span>
      <div className="flex overflow-hidden rounded border border-white/15">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            title={o.title ?? ""}
            onClick={() => onChange(o.id)}
            className={`px-2.5 py-1 font-mono text-[11px] transition-colors ${
              o.id === value ? "bg-white/15 text-white" : "text-white/50 hover:bg-white/5"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
