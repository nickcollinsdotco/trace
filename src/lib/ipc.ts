/**
 * Typed wrapper over the Tauri command surface.
 *
 * Every backend call goes through here, so there is exactly one place where
 * command names are spelled and one place to look when the Rust signature
 * changes. Nothing else in the app imports `@tauri-apps/api` directly.
 *
 * These types are hand-mirrored from `src-tauri/src/commands.rs` until
 * `tauri-specta` generates them.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AudioSource, MeetingType } from "./types";

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export interface DeviceInfo {
  name: string;
  isDefault: boolean;
}

export interface ModelStatus {
  installed: boolean;
  name: string;
  downloadBytes: number;
  directory: string;
}

/** Measured facts about this machine, for the first-run report. */
export interface SystemReport {
  host: string;
  os: string;
  kernel: string;
  cpu: string;
  cores: number | null;
  threads: number;
  memoryBytes: number;
  accelerator: string;
  modelName: string;
  modelBytes: number;
  modelDir: string;
  diskFreeBytes: number | null;
  installed: boolean;
}

/** What happens to a meeting's audio once its notes are written. */
export type AudioRetention =
  | { mode: "delete" }
  | { mode: "keep_latest"; count: number }
  | { mode: "keep_all" };

/** When the summary model occupies memory. */
export type SummaryMemory = "during_meetings" | "while_writing";

export interface Settings {
  audioRetention: AudioRetention;
  /** Id of the speech model meetings use. */
  speechModel: string;
  /** Chosen Ollama model; null means the first preferred one installed. */
  summaryModel: string | null;
  summaryMemory: SummaryMemory;
  defaultMic: string | null;
}

export interface SpeechModel {
  id: string;
  name: string;
  summary: string;
  languages: string;
  downloadBytes: number;
  installed: boolean;
  active: boolean;
}

export interface SummaryModel {
  name: string;
  sizeBytes: number;
  parameters: string | null;
  active: boolean;
}

export interface OfferedModel {
  name: string;
  summary: string;
  approxBytes: number;
  installed: boolean;
}

export interface SummaryModels {
  llm: LlmStatus;
  installed: SummaryModel[];
  recommended: OfferedModel[];
  /** What Ollama is holding in memory right now. */
  loaded: LoadedModel[];
}

export type Folder = "notes" | "models" | "logs";

export interface ModelProgress {
  /** Which speech model the progress is for. */
  model?: string;
  phase: "downloading" | "extracting" | "verifying" | "done";
  percent: number;
}

export interface StreamLevel {
  source: AudioSource;
  level: number;
}

export interface CaptureStatus {
  sessionId: string;
  title: string;
  elapsedMs: number;
  levels: StreamLevel[];
  segmentCount: number;
  /** The live transcript has holes the final pass will not. */
  droppedAudio: boolean;
  /** Chunks currently being transcribed. */
  inFlight: number;
  /** Speech spoken but not yet shown, because its chunk has not closed. */
  pendingSpeechMs: number;
  /** False when no model is installed — capture still works. */
  transcribing: boolean;
}

/** A transcript segment as the backend emits it. */
export interface LiveSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  source: AudioSource;
}

export interface NoteSummary {
  path: string;
  title: string;
  date: string;
  type: MeetingType;
  /** One line on what the meeting was about. Null until notes are generated. */
  gist: string | null;
}

/**
 * Whether notes can be generated right now.
 *
 * Three states because each has a different fix: open Ollama, or pull a model.
 */
export type LlmStatus =
  | { state: "not_running" }
  | { state: "no_model"; suggested: string }
  | { state: "ready"; model: string };

/** A note that matched a search, with enough context to judge it. */
export interface SearchHit {
  path: string;
  title: string;
  date: string;
  type: MeetingType;
  tags: string[];
  /** The title matched, not just the body. Ranked first. */
  inTitle: boolean;
  /** A body line containing a match, so the reason is visible. */
  snippet: string;
  matches: number;
}

export interface RecoverableSession {
  sessionDir: string;
  title: string;
  date: string;
  segmentCount: number;
  noteLength: number;
  corruptLines: number;
}

export interface FinishedMeeting {
  meeting: { id: string; title: string; date: string };
  notePath: string;
}

/** What the status bar shows about the app itself. */
export interface AppInfo {
  version: string;
  devBuild: boolean;
}

/** A model Ollama has in memory, and how much of it is on the GPU. */
export interface LoadedModel {
  name: string;
  sizeBytes: number;
  vramBytes: number;
  contextLength: number | null;
  /** When Ollama will unload it, RFC 3339. */
  expiresAt: string | null;
}

/** Everything worth knowing when something has gone wrong. */
export interface DiagnosticsReport {
  appVersion: string;
  devBuild: boolean;
  os: string;
  cpu: string;
  threads: number;
  memoryBytes: number;
  accelerator: string;
  speechModel: string;
  speechInstalled: boolean;
  llm: LlmStatus;
  ollamaVersion: string | null;
  preferredModels: string[];
  loadedModels: LoadedModel[];
  contextTokens: number;
  audioRetention: AudioRetention;
  summaryMemory: SummaryMemory;
  notesRoot: string;
  logDir: string;
  /** Recent log lines, oldest first. */
  recent: string[];
}

/**
 * One stage of a job. Only the kind is known until it starts; the parts of a
 * long meeting appear once it has been split.
 */
export type StepKind =
  | { kind: "transcript" }
  | { kind: "notes" }
  | { kind: "part"; index: number; total: number }
  | { kind: "combine" };

export type JobStep = StepKind & {
  /** Unix milliseconds; null while the step is waiting. */
  startedAt: number | null;
  finishedAt: number | null;
  failed: boolean;
  /** Why it failed, when the job carried on without it. */
  error: string | null;
};

export type JobOutcome =
  | { state: "generated"; dropped: number; fabricated: number; uncited: number }
  | { state: "failed"; message: string };

/**
 * Heavy work on a note after its meeting ended: the full-quality
 * re-transcription, then the summary. The backend owns these, so every screen
 * sees the same thing and a note cannot have two at once.
 */
export interface Job {
  id: number;
  notePath: string;
  title: string;
  queuedAt: number;
  steps: JobStep[];
  /** null while queued or running. */
  outcome: JobOutcome | null;
}

/* ------------------------------------------------------------------ *
 * Fake backend, for the fixture gallery
 *
 * Every backend call and every event subscription in the app passes through
 * this module, which makes it the one place a stand-in backend can be
 * installed. That is what lets `#gallery` render the *real* screens against
 * invented data — no component knows the difference, so what is on screen is
 * the actual UI rather than a copy of it that can drift.
 *
 * Dev-only. `installFakeBackend` is never called in a production build, so
 * the fixtures tree-shake out.
 * ------------------------------------------------------------------ */

export interface FakeBackend {
  /** Handle a command. Returning camelCase is fine — `camel` is idempotent. */
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Subscribe to an event. Returns an unsubscribe function. */
  listen(event: string, handler: (payload: unknown) => void): UnlistenFn;
}

let fake: FakeBackend | null = null;

export function installFakeBackend(backend: FakeBackend | null): void {
  fake = backend;
}

/* ------------------------------------------------------------------ *
 * Serde renames camelCase automatically? No — it does not.
 *
 * The Rust structs use snake_case field names and serde is not configured to
 * rename them, so the wire format is snake_case. Converting here keeps the
 * idiomatic casing on each side rather than leaking Rust naming into React.
 * ------------------------------------------------------------------ */

type Snake = Record<string, unknown>;

function camel<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camel(v)) as T;
  if (value === null || typeof value !== "object") return value as T;

  const out: Snake = {};
  for (const [key, val] of Object.entries(value as Snake)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camelKey] = camel(val);
  }
  return out as T;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (fake) return camel<T>(await fake.invoke(command, args));
  return camel<T>(await invoke(command, args));
}

/** One subscription path, so the fake backend has a single seam to sit in. */
function subscribe<T>(event: string, handler: (value: T) => void): Promise<UnlistenFn> {
  if (fake) return Promise.resolve(fake.listen(event, (p) => handler(camel<T>(p))));
  return listen(event, (e) => handler(camel<T>(e.payload)));
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

export const ipc = {
  listInputDevices: () => call<DeviceInfo[]>("list_input_devices"),
  listOutputDevices: () => call<DeviceInfo[]>("list_output_devices"),

  modelStatus: () => call<ModelStatus>("model_status"),
  systemReport: () => call<SystemReport>("system_report"),

  getSettings: () => call<Settings>("get_settings"),
  setAudioRetention: (retention: AudioRetention) =>
    call<Settings>("set_audio_retention", { retention }),
  setSummaryMemory: (memory: SummaryMemory) => call<Settings>("set_summary_memory", { memory }),
  setDefaultMic: (name: string | null) => call<Settings>("set_default_mic", { name }),
  /** Without an id, the speech model meetings will use — what first run wants. */
  installModel: (id?: string) => call<void>("install_model", { id: id ?? null }),
  speechModels: () => call<SpeechModel[]>("speech_models"),
  setSpeechModel: (id: string) => call<Settings>("set_speech_model", { id }),
  deleteSpeechModel: (id: string) => call<void>("delete_speech_model", { id }),
  summaryModels: () => call<SummaryModels>("summary_models"),
  setSummaryModel: (name: string) => call<Settings>("set_summary_model", { name }),
  pullSummaryModel: (name: string) => call<void>("pull_summary_model", { name }),
  openFolder: (kind: Folder) => call<string>("open_folder", { kind }),

  startCapture: (title: string, micDevice: string | null) =>
    call<CaptureStatus>("start_capture", { title, micDevice }),
  captureStatus: () => call<CaptureStatus | null>("capture_status"),
  updateNotes: (text: string) => call<void>("update_notes", { text }),
  setTitle: (title: string) => call<void>("set_title", { title }),
  stopCapture: () => call<FinishedMeeting>("stop_capture"),
  abortCapture: () => call<void>("abort_capture"),

  listNotes: () => call<NoteSummary[]>("list_notes"),
  readNote: (path: string) => call<string>("read_note", { path }),
  notesRoot: () => call<string>("notes_root"),
  searchNotes: (query: string) => call<SearchHit[]>("search_notes", { query }),
  noteTags: (notePath: string) => call<string[]>("note_tags", { notePath }),
  setNoteTags: (notePath: string, tags: string[]) =>
    call<string[]>("set_note_tags", { notePath, tags }),

  recoverableSessions: () => call<RecoverableSession[]>("recoverable_sessions"),
  recoverSession: (sessionDir: string) => call<string>("recover_session", { sessionDir }),
  discardSession: (sessionDir: string) => call<void>("discard_session", { sessionDir }),

  revealNotesFolder: () => call<string>("reveal_notes_folder"),
  deleteNote: (notePath: string) => call<void>("delete_note", { notePath }),
  renameNote: (notePath: string, title: string) => call<string>("rename_note", { notePath, title }),
  regenerateNotes: (notePath: string) => call<void>("regenerate_notes", { notePath }),
  canRegenerate: (notePath: string) => call<boolean>("can_regenerate", { notePath }),
  activity: () => call<Job[]>("activity"),

  llmStatus: () => call<LlmStatus>("llm_status"),
  startOllama: () => call<void>("start_ollama"),

  appInfo: () => call<AppInfo>("app_info"),
  diagnosticsReport: () => call<DiagnosticsReport>("diagnostics_report"),
};

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export const EVENT = {
  segment: "trace://segment",
  captureError: "trace://capture-error",
  modelProgress: "trace://model-progress",
  transcriptUpdated: "trace://transcript-updated",
  notesGenerated: "trace://notes-generated",
  activity: "trace://activity",
  summaryPull: "trace://summary-pull",
} as const;

/** Subscribe to live transcript segments. */
export function onSegment(handler: (segment: LiveSegment) => void): Promise<UnlistenFn> {
  return subscribe(EVENT.segment, handler);
}

export function onCaptureError(
  handler: (error: { source: AudioSource; message: string }) => void,
): Promise<UnlistenFn> {
  return subscribe(EVENT.captureError, handler);
}

export function onModelProgress(handler: (progress: ModelProgress) => void): Promise<UnlistenFn> {
  return subscribe(EVENT.modelProgress, handler);
}

/**
 * Whether the app is running inside Tauri.
 *
 * `pnpm dev` serves the frontend in a plain browser where no backend exists.
 * Screens check this so the UI degrades to an obvious empty state instead of
 * throwing on every call.
 */
export function hasBackend(): boolean {
  if (fake) return true;
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Fires when the accurate re-pass has replaced the live transcript in a
 * saved note.
 *
 * The note is written immediately when a meeting stops, using the live
 * transcript. Re-transcribing at full quality takes about two and a half
 * minutes for an hour-long meeting, so it happens in the background and this
 * announces the result.
 */
export function onTranscriptUpdated(
  handler: (info: { notePath: string; segments: number }) => void,
): Promise<UnlistenFn> {
  return subscribe(EVENT.transcriptUpdated, handler);
}

/**
 * Fires once generated notes have been written into a note, so a screen
 * showing it can read it again. What was dropped, and failures, are on the
 * job — see `onActivity`.
 */
export function onNotesGenerated(handler: (n: { notePath: string }) => void): Promise<UnlistenFn> {
  return subscribe(EVENT.notesGenerated, handler);
}

/** The whole job list, whenever any of it changes. */
export function onActivity(handler: (jobs: Job[]) => void): Promise<UnlistenFn> {
  return subscribe(EVENT.activity, handler);
}

/** Progress of a summary model downloading through Ollama. */
export function onSummaryPull(
  handler: (p: { model: string; percent: number }) => void,
): Promise<UnlistenFn> {
  return subscribe(EVENT.summaryPull, handler);
}
