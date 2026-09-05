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
  return camel<T>(await invoke(command, args));
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
  return listen(EVENT.segment, (event) => handler(camel<LiveSegment>(event.payload)));
}

export function onCaptureError(
  handler: (error: { source: AudioSource; message: string }) => void,
): Promise<UnlistenFn> {
  return listen(EVENT.captureError, (event) =>
    handler(camel<{ source: AudioSource; message: string }>(event.payload)),
  );
}

export function onModelProgress(handler: (progress: ModelProgress) => void): Promise<UnlistenFn> {
  return listen(EVENT.modelProgress, (event) => handler(camel<ModelProgress>(event.payload)));
}

/**
 * Whether the app is running inside Tauri.
 *
 * `pnpm dev` serves the frontend in a plain browser where no backend exists.
 * Screens check this so the UI degrades to an obvious empty state instead of
 * throwing on every call.
 */
export function hasBackend(): boolean {
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
  return listen(EVENT.transcriptUpdated, (event) =>
    handler(camel<{ notePath: string; segments: number }>(event.payload)),
  );
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
  return listen(EVENT.synthesisProgress, (e) => handler(camel<SynthesisProgress>(e.payload)));
}

export function onNotesGenerated(handler: (n: NotesGenerated) => void): Promise<UnlistenFn> {
  return listen(EVENT.notesGenerated, (e) => handler(camel<NotesGenerated>(e.payload)));
}

export function onSynthesisFailed(
  handler: (info: { message: string }) => void,
): Promise<UnlistenFn> {
  return listen(EVENT.synthesisFailed, (e) => handler(camel<{ message: string }>(e.payload)));
}
