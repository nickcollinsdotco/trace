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
  type CaptureStatus,
  type DeviceInfo,
  EVENT,
  type FakeBackend,
  type FinishedMeeting,
  type ModelStatus,
  type NoteSummary,
  type RecoverableSession,
  type Settings,
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
  /** Facts shown on the first-run report. */
  systemReport: SystemReport;
  settings: Settings;
  /** Commands that should reject, mapped to their message. */
  failures: Record<string, string>;
}

export const DEFAULT_STATE: BackendState = {
  notes: [],
  bodies: {},
  recoverable: [],
  model: {
    installed: true,
    name: "parakeet-tdt-0.6b-v3-int8",
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
  settings: { keepAudio: false },
  failures: {},
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

  const emit = (event: string, payload: unknown) => {
    for (const h of handlers.get(event) ?? []) h(payload);
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
        for (const id of timers) window.clearTimeout(id);
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
        case "set_keep_audio":
          settings = { keepAudio: Boolean(args?.keep) };
          return settings;
        case "system_report":
          return state.systemReport;
        case "install_model":
          return simulateDownload(emit).then(() => {
            model = { ...model, installed: true };
            return null;
          });

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
          return state.notes;
        case "read_note": {
          const path = args?.path as string;
          const body = state.bodies[path];
          if (body === undefined) throw new Error(`no such note: ${path}`);
          return body;
        }
        case "notes_root":
          return state.root;

        case "search_notes": {
          // Mirrors the real matcher closely enough to be worth looking at:
          // every term must appear, case-insensitive, title hits first.
          const terms = String(args?.query ?? "")
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);
          if (terms.length === 0) return [];

          return state.notes
            .filter((n) => {
              const body = (state.bodies[n.path] ?? "").toLowerCase();
              const hay = `${n.title.toLowerCase()} ${body}`;
              return terms.every((t) => hay.includes(t));
            })
            .map((n) => {
              const body = state.bodies[n.path] ?? "";
              const line =
                body
                  .split("\n")
                  .find(
                    (l) => terms.some((t) => l.toLowerCase().includes(t)) && !l.includes(":"),
                  ) ?? "";
              return {
                ...n,
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
        case "regenerate_notes":
          return null;
        case "can_regenerate":
          return state.canRegenerate;

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

/** Walks the download through its phases so the boot sequence can be watched. */
function simulateDownload(emit: (event: string, payload: unknown) => void): Promise<null> {
  return new Promise((resolve) => {
    let percent = 0;
    const id = window.setInterval(() => {
      percent += 7;
      if (percent < 100) {
        emit(EVENT.modelProgress, { phase: "downloading", percent });
        return;
      }
      window.clearInterval(id);
      emit(EVENT.modelProgress, { phase: "verifying", percent: 100 });
      window.setTimeout(() => {
        emit(EVENT.modelProgress, { phase: "done", percent: 100 });
        resolve(null);
      }, 700);
    }, 140);
  });
}
