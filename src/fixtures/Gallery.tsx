/**
 * The fixture gallery — `#gallery` in dev.
 *
 * Every screen, in every state worth seeing, without recording anything, and
 * under any theme. This is the tool that makes the visual pass possible: the
 * reason it kept being deferred is that looking at a screen used to cost a
 * meeting.
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

import { useEffect, useMemo, useRef, useState } from "react";
import { ModelGate } from "../app/ModelGate";
import { Wordmark } from "../app/Wordmark";
import {
  applyTheme,
  FRAMES,
  type Frame,
  loadTheme,
  MONO_NOTES,
  MONOS,
  type Mono,
  saveTheme,
  THEME_FRAME,
  THEME_NOTES,
  THEME_TYPE,
  THEMES,
  type Theme,
  TYPE_NOTES,
  TYPES,
  type TypeRole,
} from "../design/theme";
import { CaptureScreen } from "../features/capture/CaptureScreen";
import { LibraryScreen } from "../features/library/LibraryScreen";
import { NoteScreen } from "../features/note/NoteScreen";
import { installFakeBackend } from "../lib/ipc";
import { makeBackend } from "./backend";
import { SCENARIOS, type Scenario, scenarioById } from "./scenarios";

/** Widths worth checking. The app is a desktop window, not a phone. */
const WIDTHS = [
  { id: "narrow", label: "760", px: 760 },
  { id: "default", label: "1100", px: 1100 },
  { id: "wide", label: "full", px: 0 },
] as const;

export function Gallery() {
  const [scenarioId, setScenarioId] = useState(
    () => location.hash.split("/")[1] ?? SCENARIOS[0]?.id ?? "",
  );
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [width, setWidth] = useState<(typeof WIDTHS)[number]["id"]>("default");
  // null on any axis = follow the theme's own choice, so one thing can be
  // varied at a time instead of only ever comparing whole looks.
  const [frame, setFrame] = useState<Frame | null>(null);
  const [mono, setMono] = useState<Mono | null>(null);
  const [role, setRole] = useState<TypeRole | null>(null);
  const preview = useRef<HTMLDivElement>(null);

  const scenario = scenarioById(scenarioId) ?? SCENARIOS[0];

  /*
   * Installed during render, deliberately.
   *
   * The screens call the backend from their very first effect, so the stand-in
   * has to be in place before they mount — which means before this function
   * returns. `useMemo` is the earliest correct hook for that, and installing
   * is idempotent, so StrictMode's double render is harmless.
   */
  useMemo(() => {
    installFakeBackend(scenario ? makeBackend(scenario.state) : null);
  }, [scenario]);

  useEffect(() => () => installFakeBackend(null), []);

  useEffect(() => {
    if (preview.current) {
      applyTheme(theme, preview.current, {
        frame: frame ?? undefined,
        mono: mono ?? undefined,
        role: role ?? undefined,
      });
    }
    saveTheme(theme);
  }, [theme, frame, mono, role]);

  useEffect(() => {
    if (scenario) location.hash = `gallery/${scenario.id}`;
  }, [scenario]);

  const groups = [...new Set(SCENARIOS.map((s) => s.group))];
  const px = WIDTHS.find((w) => w.id === width)?.px ?? 0;

  return (
    <div className="flex h-full bg-[#17171a] text-[#d8d8dc]">
      <nav className="flex w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-white/10 p-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">
            TRACE gallery
          </p>
          <p className="mt-1 text-[11px] leading-snug text-white/30">
            Real screens, invented data. Dev only.
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
        <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-white/10 px-4 py-2.5">
          <Switcher
            label="Theme"
            options={THEMES.map((t) => ({ id: t, label: t, title: THEME_NOTES[t] }))}
            value={theme}
            onChange={(v) => setTheme(v as Theme)}
          />
          <Switcher
            label="Frame"
            options={[
              { id: "auto", label: `auto (${THEME_FRAME[theme]})` },
              ...FRAMES.map((f) => ({ id: f, label: f })),
            ]}
            value={frame ?? "auto"}
            onChange={(v) => setFrame(v === "auto" ? null : (v as Frame))}
          />
          <Switcher
            label="Type"
            options={[
              { id: "auto", label: `auto (${THEME_TYPE[theme].role})` },
              ...TYPES.map((t) => ({ id: t, label: t, title: TYPE_NOTES[t] })),
            ]}
            value={role ?? "auto"}
            onChange={(v) => setRole(v === "auto" ? null : (v as TypeRole))}
          />
          <Switcher
            label="Mono"
            options={[
              { id: "auto", label: `auto (${THEME_TYPE[theme].mono})` },
              ...MONOS.map((m) => ({ id: m, label: m, title: MONO_NOTES[m] })),
            ]}
            value={mono ?? "auto"}
            onChange={(v) => setMono(v === "auto" ? null : (v as Mono))}
          />
          <Switcher
            label="Width"
            options={WIDTHS.map((w) => ({ id: w.id, label: w.label }))}
            value={width}
            onChange={(v) => setWidth(v as typeof width)}
          />
          {scenario && (
            <p className="ml-auto max-w-md text-right text-[11px] leading-snug text-white/40">
              {scenario.note}
            </p>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-6">
          <div
            ref={preview}
            style={px ? { width: px } : undefined}
            className="mx-auto flex h-full min-h-[560px] flex-col overflow-hidden rounded-md border border-white/10 bg-surface-0 shadow-2xl"
          >
            {/*
              Keyed by scenario so switching genuinely remounts. Without this a
              screen would keep the state it had built up under the previous
              fixture, and show something that has never existed.
            */}
            {scenario && <Preview key={scenario.id} scenario={scenario} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The app shell, reproduced exactly as `App.tsx` builds it. */
function Preview({ scenario }: { scenario: Scenario }) {
  return (
    <div className="flex h-full flex-col bg-surface-0">
      <header className="flex shrink-0 items-center gap-4 border-b border-line px-5 py-3">
        <Wordmark />
        <span aria-hidden className="trace-rule" />
        <ModelGate />
      </header>

      <main className="min-h-0 flex-1">
        {scenario.screen === "library" && (
          <LibraryScreen onNewMeeting={() => {}} onOpenNote={() => {}} />
        )}
        {scenario.screen === "capture" && <CaptureScreen onFinish={() => {}} />}
        {scenario.screen === "note" && (
          <NoteScreen path={scenario.notePath ?? ""} onBack={() => {}} />
        )}
      </main>
    </div>
  );
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
