/**
 * A stand-in backend, so the gallery can render the real screens.
 *
 * This answers the same command names Rust does and pushes the same events,
 * which means `LibraryScreen`, `CaptureScreen` and `NoteScreen` mount
 * unmodified and unaware. That is the whole design: what you look at in the
 * gallery is the actual UI, not a mock of it that quietly drifts out of date.
 *
 * Dev-only — nothing in the production path imports this file.
 */

import {
  type AppInfo,
  type CaptureStatus,
  type DeviceInfo,
  type DiagnosticsReport,
  EVENT,
  type FakeBackend,
  type FinishedMeeting,
  type Job,
  type LlmStatus,
  type ModelStatus,
  type NoteContext,
  type NoteSummary,
  type OfferedModel,
  type RecoverableSession,
  type Settings,
  type SpeechModel,
  type SummaryModel,
  type SystemReport,
} from "../lib/ipc";
import type { AudioSource } from "../lib/types";

/** A scripted event, fired `atMs` after the fake session starts. */
export interface ScriptedEvent {
  atMs: number;
  event: string;
  payload: unknown;
}

/** Everything a scenario can vary about the backend. */
export interface BackendState {
  notes: NoteSummary[];
  /** Note path → Markdown body. */
  bodies: Record<string, string>;
  recoverable: RecoverableSession[];
  model: ModelStatus;
  devices: DeviceInfo[];
  root: string;
  /**
   * Where a started session begins. Non-zero so pressing Start lands in a
   * realistic mid-meeting state rather than an empty one — an empty transcript
   * tells you nothing about how the screen behaves when it is full.
   */
  startElapsedMs: number;
  /** Live status overrides, for warning and error states. */
  statusOverrides: Partial<CaptureStatus>;
  /**
   * Whether a session is already running when the screen mounts.
   *
   * The capture screen asks the backend on mount, so this is all it takes to
   * land straight in the live state — meters moving, transcript filling —
   * rather than on the setup panel. Looking at a live recording should not
   * require pressing a button first.
   */
  recording: boolean;
  /** When the script begins. Capture scenarios that start idle wait for Start. */
  scriptStartsOn: "subscribe" | "capture";
  /** Events fired on a timer, relative to when the script starts. */
  script: ScriptedEvent[];
  /** Fired immediately on subscribe rather than on a timer. */
  immediate: ScriptedEvent[];
  /** Whether the open note's journal still exists. */
  canRegenerate: boolean;
  /**
   * Background jobs when the scenario opens.
   *
   * Times here — and in scripted `EVENT.activity` payloads — are milliseconds
   * relative to the moment they are handed over, negative for the past. A
   * scenario is defined once at import but opened whenever, and absolute
   * times would show a job that has apparently been running since page load.
   */
  activity: Job[];
  /**
   * Note path → the body it has once notes are generated, so a scenario can
   * show a note gaining its summary rather than reloading the same text.
   */
  afterGenerate: Record<string, string>;
  /** Note path → tags. */
  tags: Record<string, string[]>;
  /** Note path → what the user has said about the meeting since. */
  contexts: Record<string, NoteContext>;
  /** Facts shown on the first-run report. */
  systemReport: SystemReport;
  settings: Settings;
  /** Commands that should reject, mapped to their message. */
  failures: Record<string, string>;
  /** Whether Ollama is usable. Opening it from the notice makes it ready. */
  llm: LlmStatus;
  appInfo: AppInfo;
  /** Log lines the diagnostics screen shows, oldest first. */
  recentLog: string[];
  speechModels: SpeechModel[];
  /** Models Ollama has, when it is running. */
  summaryInstalled: SummaryModel[];
  /** What the Models page offers to download. */
  summaryOffered: Omit<OfferedModel, "installed">[];
}

export const DEFAULT_STATE: BackendState = {
  notes: [],
  bodies: {},
  recoverable: [],
  model: {
    installed: true,
    // The display name, as `model_status` returns it.
    name: "Parakeet TDT 0.6B v3 (int8)",
    downloadBytes: 680 * 1_048_576,
    directory: "C:\\Users\\you\\AppData\\Local\\TRACE\\models",
  },
  devices: [
    { name: "Microphone (Yeti X)", isDefault: true },
    { name: "Headset Microphone (Jabra)", isDefault: false },
  ],
  root: "C:\\Users\\you\\Documents\\TRACE",
  startElapsedMs: 0,
  recording: false,
  scriptStartsOn: "subscribe",
  statusOverrides: {},
  script: [],
  immediate: [],
  canRegenerate: true,
  activity: [],
  afterGenerate: {},
  tags: {},
  contexts: {},
  systemReport: {
    host: "NICK-DESKTOP",
    os: "Windows 10 Home",
    kernel: "19045",
    cpu: "AMD Ryzen 7 7800X3D 8-Core Processor",
    cores: 8,
    threads: 16,
    memoryBytes: 33_395_507_200,
    accelerator: "CPU · ONNX Runtime (int8)",
    modelName: "Parakeet TDT 0.6B v3 (int8)",
    modelBytes: 478_517_071,
    modelDir: "C:\\Users\\you\\AppData\\Local\\TRACE\\models\\parakeet-tdt-0.6b-v3-int8",
    diskFreeBytes: 222_290_000_000,
    installed: false,
  },
  settings: {
    // The real default, so tests of "off by default" test the truth.
    audioRetention: { mode: "delete" },
    speechModel: "parakeet-tdt-0.6b-v3-int8",
    summaryModel: null,
    summaryMemory: "during_meetings",
    defaultMic: null,
  },
  failures: {},
  llm: { state: "ready", model: "qwen3:14b" },
  appInfo: { version: "0.1.0", devBuild: true },
  speechModels: [
    {
      id: "parakeet-tdt-0.6b-v3-int8",
      name: "Parakeet TDT 0.6B v3 (int8)",
      summary: "Fast and accurate, and handles 25 European languages",
      languages: "25 European languages",
      downloadBytes: 478_517_071,
      installed: true,
      active: true,
    },
    {
      id: "parakeet-tdt-0.6b-v2-int8",
      name: "Parakeet TDT 0.6B v2 (int8)",
      summary: "The most accurate for English-only meetings",
      languages: "English only",
      downloadBytes: 473_000_000,
      installed: false,
      active: false,
    },
  ],
  summaryInstalled: [
    { name: "qwen3:14b", sizeBytes: 9_276_198_565, parameters: "14.8B", active: true },
    { name: "qwen3:8b", sizeBytes: 5_225_387_923, parameters: "8.2B", active: false },
  ],
  summaryOffered: [
    {
      name: "qwen3:14b",
      summary: "Best notes. Wants about 11 GB of video memory",
      approxBytes: 9_300_000_000,
    },
    {
      name: "qwen3:8b",
      summary: "Good notes on most machines. About 6.5 GB of video memory",
      approxBytes: 5_200_000_000,
    },
    {
      name: "gemma3:12b",
      summary: "An alternative voice for comparison. About 10 GB of video memory",
      approxBytes: 8_100_000_000,
    },
  ],
  recentLog: [
    "2026-09-23 09:58:02 TRACE 0.1.0 started",
    "2026-09-23 10:00:11 meeting started, microphone: Microphone (Yeti X)",
    '2026-09-23 10:41:37 stream Microphone on "Microphone (Yeti X)": 2486s at 48000 Hz, 0 chunks dropped, 1 stream errors',
    '2026-09-23 10:41:37 stream System on "Speakers (Realtek)": 2486s at 48000 Hz, 0 chunks dropped, 0 stream errors',
    "2026-09-23 10:41:38 meeting ended: 412 live segments, 0 characters of notes",
    "2026-09-23 10:44:02 summarising with qwen3:14b",
    "2026-09-23 10:45:10 summary written in 68s: 6 key points, 2 decisions, 4 action items, 1 discarded",
    "2026-09-23 10:45:10 summary model qwen3:14b released from memory",
  ],
};

type Handler = (payload: unknown) => void;

/**
 * The meters need to move.
 *
 * A still screenshot cannot answer whether a level meter reads as "live" or
 * as noise, so the fake status generates plausible levels from a clock. The
 * microphone is quieter and burstier than the system stream, which is what a
 * call actually sounds like from this side of it.
 */
function levels(t: number): Array<{ source: AudioSource; level: number }> {
  const mic = 0.18 + 0.3 * Math.abs(Math.sin(t / 260)) * Math.abs(Math.sin(t / 90));
  const sys = 0.24 + 0.34 * Math.abs(Math.sin(t / 410 + 1.2));
  return [
    { source: "microphone", level: mic },
    { source: "system", level: sys },
  ];
}

export function makeBackend(partial: Partial<BackendState> = {}): FakeBackend {
  const state: BackendState = { ...DEFAULT_STATE, ...partial };
  const handlers = new Map<string, Set<Handler>>();
  const timers: number[] = [];

  let startedAt: number | null = state.recording ? Date.now() : null;
  let segmentCount = 0;
  // Mutable, so the first-run scenario can be watched all the way through to
  // "Ready" instead of snapping back to "no model" when the download finishes.
  let model = state.model;
  let settings = state.settings;
  let llm = state.llm;
  let speechModels = state.speechModels.map((m) => ({ ...m }));
  let summaryInstalled = state.summaryInstalled.map((m) => ({ ...m }));

  // What the real backend derives: the active flags follow the choice.
  const activeSummary = () => (llm.state === "ready" ? llm.model : null);

  // Resident only while TRACE needs it, as the real backend holds it: through
  // a meeting when Settings keeps it ready, and while notes are being written.
  // Released straight after, so an idle library shows nothing in memory. The
  // lease is renewed while held, so "until" is always minutes away.
  const loaded = () => {
    const meeting = startedAt !== null && settings.summaryMemory === "during_meetings";
    const writing = jobs.some((j) => j.outcome === null);
    return llm.state === "ready" && (meeting || writing)
      ? [
          {
            name: llm.model,
            sizeBytes: 11_274_289_152,
            vramBytes: 11_274_289_152,
            contextLength: 8192,
            expiresAt: new Date(Date.now() + 8 * 60_000).toISOString(),
          },
        ]
      : [];
  };
  const tags: Record<string, string[]> = { ...state.tags };
  const contexts: Record<string, NoteContext> = { ...state.contexts };
  let micPreviewFrom: number | null = null;

  const bodies: Record<string, string> = { ...state.bodies };
  let jobs = rebase(state.activity);

  // Mirrors the real backend: the job list is state, and the event carries
  // all of it, so a screen mounting mid-scenario reads the same thing.
  const emit = (event: string, payload: unknown) => {
    let sent = payload;
    if (event === EVENT.activity) {
      jobs = rebase(payload as Job[]);
      sent = jobs;
    }
    if (event === EVENT.notesGenerated) {
      const path = (payload as { notePath: string }).notePath;
      const next = state.afterGenerate[path];
      if (next !== undefined) bodies[path] = next;
    }
    for (const h of handlers.get(event) ?? []) h(sent);
  };

  const runScript = () => {
    for (const e of state.script) {
      timers.push(
        window.setTimeout(() => {
          if (e.event === EVENT.segment) segmentCount++;
          emit(e.event, e.payload);
        }, e.atMs),
      );
    }
  };

  // Note screens have no Start button, so their script runs as soon as
  // something subscribes.
  let scriptStarted = false;
  const startScriptOnce = () => {
    if (scriptStarted) return;
    scriptStarted = true;
    runScript();
  };

  return {
    listen(event, handler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);

      for (const e of state.immediate) {
        if (e.event === event) window.setTimeout(() => handler(e.payload), 0);
      }
      if (state.scriptStartsOn === "subscribe") startScriptOnce();

      return () => {
        set?.delete(handler);
        // Stop the script only once nothing at all is listening. Clearing it
        // on any unsubscribe let one component unmounting — or StrictMode's
        // dev-only mount, unmount, mount — silently kill every scripted
        // scenario, which then sat on its first frame.
        const listening = [...handlers.values()].some((s) => s.size > 0);
        if (!listening) {
          for (const id of timers) window.clearTimeout(id);
          timers.length = 0;
          scriptStarted = false;
        }
      };
    },

    async invoke(command, args) {
      const failure = state.failures[command];
      if (failure) throw new Error(failure);

      switch (command) {
        case "list_input_devices":
          return state.devices;
        case "list_output_devices":
          return [{ name: "Speakers (Realtek)", isDefault: true }];

        case "model_status":
          return model;
        case "get_settings":
          return settings;
        case "set_audio_retention":
          settings = { ...settings, audioRetention: args?.retention as Settings["audioRetention"] };
          return settings;
        case "set_summary_memory":
          settings = { ...settings, summaryMemory: args?.memory as Settings["summaryMemory"] };
          return settings;
        case "set_default_mic":
          settings = { ...settings, defaultMic: (args?.name as string | null) ?? null };
          return settings;

        case "speech_models":
          return speechModels;
        case "set_speech_model": {
          const id = args?.id as string;
          speechModels = speechModels.map((m) => ({ ...m, active: m.id === id }));
          settings = { ...settings, speechModel: id };
          return settings;
        }
        case "delete_speech_model": {
          const id = args?.id as string;
          speechModels = speechModels.map((m) => (m.id === id ? { ...m, installed: false } : m));
          return null;
        }

        case "summary_models": {
          const running = llm.state !== "not_running";
          const installed = running
            ? summaryInstalled.map((m) => ({ ...m, active: m.name === activeSummary() }))
            : [];
          return {
            llm,
            installed,
            recommended: state.summaryOffered.map((r) => ({
              ...r,
              installed: installed.some((m) => m.name === r.name),
            })),
            loaded: loaded(),
          };
        }
        case "set_summary_model": {
          const name = args?.name as string;
          llm = { state: "ready", model: name };
          settings = { ...settings, summaryModel: name };
          return settings;
        }
        case "pull_summary_model": {
          const name = args?.name as string;
          return simulatePull(emit, name).then(() => {
            const offered = state.summaryOffered.find((r) => r.name === name);
            summaryInstalled = [
              ...summaryInstalled,
              { name, sizeBytes: offered?.approxBytes ?? 0, parameters: null, active: false },
            ];
            if (llm.state === "no_model") llm = { state: "ready", model: name };
            return null;
          });
        }
        case "open_folder":
          return `C:\\Users\\you\\${String(args?.kind)}`;
        case "system_report":
          return state.systemReport;
        case "install_model": {
          const id = (args?.id as string | null) ?? undefined;
          return simulateDownload(emit, id).then(() => {
            if (id) {
              speechModels = speechModels.map((m) => (m.id === id ? { ...m, installed: true } : m));
            } else {
              model = { ...model, installed: true };
            }
            return null;
          });
        }

        case "start_capture": {
          startedAt = Date.now();
          segmentCount = 0;
          startScriptOnce();
          return status(state, startedAt, segmentCount, args?.title as string);
        }
        case "capture_status":
          return startedAt === null ? null : status(state, startedAt, segmentCount);
        case "update_notes":
        case "set_title":
          return null;
        case "stop_capture": {
          startedAt = null;
          const finished: FinishedMeeting = {
            meeting: { id: "fixture", title: "Fixture meeting", date: "2026-09-05" },
            notePath: state.notes[0]?.path ?? "",
          };
          return finished;
        }

        case "list_notes":
          // Tags from the live map, so one added on a note shows in the
          // library on the way back — the thing that was broken for real.
          return state.notes.map((n) => ({ ...n, tags: tags[n.path] ?? [] }));
        case "read_note": {
          const path = args?.path as string;
          const body = bodies[path];
          if (body === undefined) throw new Error(`no such note: ${path}`);
          return body;
        }
        case "notes_root":
          return state.root;

        case "search_notes": {
          // Mirrors the real matcher closely enough to be worth looking at:
          // every term must appear, case-insensitive, title hits first, and
          // `tag:` narrows to the tag list rather than the text.
          const words = String(args?.query ?? "")
            .split(/\s+/)
            .filter(Boolean);
          const wantedTags = words
            .filter((w) => w.startsWith("tag:"))
            .map((w) => w.slice(4).toLowerCase());
          const terms = words.filter((w) => !w.startsWith("tag:")).map((w) => w.toLowerCase());
          if (terms.length === 0 && wantedTags.length === 0) return [];

          return state.notes
            .filter((n) => {
              const noteTags = tags[n.path] ?? [];
              if (!wantedTags.every((w) => noteTags.includes(w))) return false;
              const body = (bodies[n.path] ?? "").toLowerCase();
              const hay = `${n.title.toLowerCase()} ${body}`;
              return terms.every((t) => hay.includes(t));
            })
            .map((n) => {
              const body = bodies[n.path] ?? "";
              const line =
                body
                  .split("\n")
                  .find(
                    (l) => terms.some((t) => l.toLowerCase().includes(t)) && !l.includes(":"),
                  ) ?? "";
              return {
                ...n,
                tags: tags[n.path] ?? [],
                inTitle: terms.some((t) => n.title.toLowerCase().includes(t)),
                snippet: line.replaceAll("**", "").replaceAll("`", "").trim(),
                matches: 1,
              };
            })
            .sort((a, b) => Number(b.inTitle) - Number(a.inTitle));
        }

        case "recoverable_sessions":
          return state.recoverable;
        case "recover_session":
        case "discard_session":
        case "abort_capture":
          return null;

        case "delete_note": {
          const path = args?.notePath as string;
          state.notes = state.notes.filter((n) => n.path !== path);
          return null;
        }
        case "rename_note": {
          const path = args?.notePath as string;
          const title = args?.title as string;
          const note = state.notes.find((n) => n.path === path);
          if (note) note.title = title;
          return path;
        }

        case "reveal_notes_folder":
          return state.root;
        case "regenerate_notes": {
          const path = args?.notePath as string;
          if (jobs.some((j) => j.notePath === path && j.outcome === null)) {
            throw new Error("notes for this meeting are already being written");
          }
          const title = state.notes.find((n) => n.path === path)?.title ?? "";
          return simulateRegenerate(emit, () => jobs, path, title);
        }
        case "can_regenerate":
          return state.canRegenerate;
        case "activity":
          return jobs;

        case "llm_status":
          return llm;
        case "app_info":
          return state.appInfo;
        case "diagnostics_report": {
          const report: DiagnosticsReport = {
            appVersion: state.appInfo.version,
            devBuild: state.appInfo.devBuild,
            os: `${state.systemReport.os} (${state.systemReport.kernel})`,
            cpu: state.systemReport.cpu,
            threads: state.systemReport.threads,
            memoryBytes: state.systemReport.memoryBytes,
            accelerator: state.systemReport.accelerator,
            speechModel: state.systemReport.modelName,
            speechInstalled: model.installed,
            llm,
            ollamaVersion: llm.state === "not_running" ? null : "0.12.3",
            preferredModels: ["qwen3:14b", "qwen3:8b", "gemma3:12b"],
            loadedModels: loaded(),
            contextTokens: 8192,
            audioRetention: settings.audioRetention,
            summaryMemory: settings.summaryMemory,
            notesRoot: state.root,
            logDir: "C:\\Users\\you\\AppData\\Local\\TRACE\\logs",
            recent: state.recentLog,
          };
          return report;
        }
        case "start_ollama":
          // Ready a moment later, as the real one is: the notice should be
          // seen clearing itself, not vanishing on click.
          window.setTimeout(() => {
            llm = { state: "ready", model: "qwen3:8b" };
          }, 1_500);
          return null;

        case "note_tags":
          return tags[args?.notePath as string] ?? [];
        case "set_note_tags": {
          // Normalise the way the real store does, so the gallery shows what
          // would actually be written rather than what was typed.
          const path = args?.notePath as string;
          const clean = [
            ...new Set(
              ((args?.tags as string[]) ?? [])
                .map((t) => t.trim().toLowerCase().split(/\s+/).join("-"))
                .filter(Boolean),
            ),
          ].sort();
          tags[path] = clean;
          return clean;
        }

        case "start_mic_preview":
          micPreviewFrom = Date.now();
          return null;
        case "stop_mic_preview":
          micPreviewFrom = null;
          return null;
        case "mic_preview_level": {
          if (micPreviewFrom === null) return null;
          // Syllables: a fast wobble inside slower phrases with pauses, which
          // is what a voice looks like at this resolution.
          const t = (Date.now() - micPreviewFrom) / 1000;
          const phrase = Math.max(0, Math.sin(t * 1.3));
          return 0.02 + 0.12 * phrase * (0.6 + 0.4 * Math.abs(Math.sin(t * 11)));
        }

        case "note_context":
          return contexts[args?.notePath as string] ?? { context: "", participants: [] };
        case "set_note_context": {
          const path = args?.notePath as string;
          const names: string[] = [];
          for (const raw of (args?.participants as string[]) ?? []) {
            const name = raw.trim();
            if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) {
              names.push(name);
            }
          }
          const stored = { context: String(args?.context ?? "").trim(), participants: names };
          contexts[path] = stored;
          return stored;
        }

        default:
          throw new Error(`fixture backend: unhandled command "${command}"`);
      }
    },
  };
}

function status(
  state: BackendState,
  startedAt: number,
  segmentCount: number,
  title?: string,
): CaptureStatus {
  const elapsedMs = state.startElapsedMs + (Date.now() - startedAt);
  return {
    sessionId: "20260905-1400-fixture",
    title: title ?? "Fixture meeting",
    elapsedMs,
    levels: levels(elapsedMs),
    segmentCount,
    droppedAudio: false,
    inFlight: 0,
    pendingSpeechMs: 0,
    transcribing: state.model.installed,
    ...state.statusOverrides,
  };
}

/** Relative job times made absolute. See `BackendState.activity`. */
function rebase(jobs: Job[]): Job[] {
  const now = Date.now();
  const at = (t: number | null) => (t === null ? null : now + t);
  return jobs.map((j) => ({
    ...j,
    queuedAt: now + j.queuedAt,
    steps: j.steps.map((s) => ({ ...s, startedAt: at(s.startedAt), finishedAt: at(s.finishedAt) })),
  }));
}

/**
 * A regenerate, compressed into a few seconds: three parts and the combining
 * pass, published the way the real backend publishes them. Pressing ↻ in the
 * gallery shows the whole sequence rather than nothing.
 */
function simulateRegenerate(
  emit: (event: string, payload: unknown) => void,
  current: () => Job[],
  notePath: string,
  title: string,
): Promise<null> {
  // Times are relative, as every activity payload here is; each step is
  // stamped with how long ago it started as of the moment it is sent.
  const t0 = Date.now();
  const rel = (at: number) => at - (Date.now() - t0);
  const id = Math.max(0, ...current().map((j) => j.id)) + 1;
  const part = (index: number) => ({ kind: "part" as const, index, total: 3 });
  const marks = [0, 1_400, 2_800, 4_000, 4_900];

  const snapshot = (reached: number, outcome: Job["outcome"] = null): Job[] => {
    const kinds = [part(1), part(2), part(3), { kind: "combine" as const }];
    const job: Job = {
      id,
      notePath,
      title,
      queuedAt: rel(0),
      steps: kinds.map((k, i) => ({
        ...k,
        startedAt: i < reached ? rel(marks[i] ?? 0) : null,
        finishedAt: i < reached - 1 || outcome ? rel(marks[i + 1] ?? 0) : null,
        failed: false,
        error: null,
      })),
      outcome,
    };
    // Relative times for everyone else too, since the payload is rebased.
    const others = current()
      .filter((j) => j.notePath !== notePath)
      .map((j) => ({
        ...j,
        queuedAt: j.queuedAt - Date.now(),
        steps: j.steps.map((s) => ({
          ...s,
          startedAt: s.startedAt === null ? null : s.startedAt - Date.now(),
          finishedAt: s.finishedAt === null ? null : s.finishedAt - Date.now(),
        })),
      }));
    return [...others, job];
  };

  return new Promise((resolve) => {
    [1, 2, 3, 4].forEach((reached, i) => {
      window.setTimeout(() => emit(EVENT.activity, snapshot(reached)), marks[i]);
    });
    window.setTimeout(() => {
      emit(EVENT.notesGenerated, { notePath });
      emit(
        EVENT.activity,
        snapshot(4, { state: "generated", dropped: 0, fabricated: 0, uncited: 0 }),
      );
      resolve(null);
    }, marks[4]);
  });
}

/** Ollama's pull, stepped, so the Models page progress bar can be watched. */
function simulatePull(
  emit: (event: string, payload: unknown) => void,
  model: string,
): Promise<null> {
  return new Promise((resolve) => {
    let percent = 0;
    const id = window.setInterval(() => {
      percent = Math.min(100, percent + 9);
      emit(EVENT.summaryPull, { model, percent });
      if (percent === 100) {
        window.clearInterval(id);
        resolve(null);
      }
    }, 120);
  });
}

/** Walks the download through its phases so the boot sequence can be watched. */
function simulateDownload(
  emit: (event: string, payload: unknown) => void,
  model?: string,
): Promise<null> {
  return new Promise((resolve) => {
    let percent = 0;
    const id = window.setInterval(() => {
      percent += 7;
      if (percent < 100) {
        emit(EVENT.modelProgress, { model, phase: "downloading", percent });
        return;
      }
      window.clearInterval(id);
      emit(EVENT.modelProgress, { model, phase: "verifying", percent: 100 });
      window.setTimeout(() => {
        emit(EVENT.modelProgress, { model, phase: "done", percent: 100 });
        resolve(null);
      }, 700);
    }, 140);
  });
}
