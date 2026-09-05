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

export interface ModelProgress {
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
  installModel: () => call<void>("install_model"),

  startCapture: (title: string, micDevice: string | null) =>
    call<CaptureStatus>("start_capture", { title, micDevice }),
  captureStatus: () => call<CaptureStatus | null>("capture_status"),
  updateNotes: (text: string) => call<void>("update_notes", { text }),
  setTitle: (title: string) => call<void>("set_title", { title }),
  stopCapture: () => call<FinishedMeeting>("stop_capture"),

  listNotes: () => call<NoteSummary[]>("list_notes"),
  readNote: (path: string) => call<string>("read_note", { path }),
  notesRoot: () => call<string>("notes_root"),

  recoverableSessions: () => call<RecoverableSession[]>("recoverable_sessions"),
  recoverSession: (sessionDir: string) => call<string>("recover_session", { sessionDir }),
  discardSession: (sessionDir: string) => call<void>("discard_session", { sessionDir }),

  revealNotesFolder: () => call<string>("reveal_notes_folder"),
  regenerateNotes: (notePath: string) => call<void>("regenerate_notes", { notePath }),
  canRegenerate: (notePath: string) => call<boolean>("can_regenerate", { notePath }),
};

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export const EVENT = {
  segment: "trace://segment",
  captureError: "trace://capture-error",
  modelProgress: "trace://model-progress",
  transcriptUpdated: "trace://transcript-updated",
  synthesisProgress: "trace://synthesis-progress",
  notesGenerated: "trace://notes-generated",
  synthesisFailed: "trace://synthesis-failed",
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

/** Progress through a long meeting's synthesis windows. */
export interface SynthesisProgress {
  window: number;
  total: number;
}

/**
 * Result of generating structured notes.
 *
 * `dropped` counts items discarded for citing something that does not exist.
 * Surfaced rather than hidden: the user should be told the model made things
 * up, not quietly shown a shorter list.
 */
export interface NotesGenerated {
  notePath: string;
  dropped: number;
  fabricated: number;
  uncited: number;
}

export function onSynthesisProgress(handler: (p: SynthesisProgress) => void): Promise<UnlistenFn> {
  return subscribe(EVENT.synthesisProgress, handler);
}

export function onNotesGenerated(handler: (n: NotesGenerated) => void): Promise<UnlistenFn> {
  return subscribe(EVENT.notesGenerated, handler);
}

export function onSynthesisFailed(
  handler: (info: { message: string }) => void,
): Promise<UnlistenFn> {
  return subscribe(EVENT.synthesisFailed, handler);
}
