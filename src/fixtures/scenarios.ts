/**
 * Every state worth looking at, named.
 *
 * The reason the visual pass kept getting deferred is that seeing a screen
 * cost a recording: to look at reading mode you needed a real meeting, to see
 * the processing indicator you had to catch it mid-gap, to judge a long
 * transcript you had to talk for ninety minutes. This list is that cost
 * removed.
 *
 * Failure and empty states are here in the same weight as the happy path,
 * deliberately. A tool whose job is not losing things should look most
 * trustworthy at the moment something has gone wrong, and that is impossible
 * to design if you never see it.
 */

import { EVENT, type NoteSummary } from "../lib/ipc";
import type { BackendState, ScriptedEvent } from "./backend";
import { NOTE_ENHANCED, NOTE_LONG, NOTE_NOTHING, NOTE_RAW } from "./notes";

export type ScreenName = "library" | "capture" | "note";

export interface Scenario {
  id: string;
  name: string;
  group: "Library" | "Capture" | "Reading" | "First run";
  /** What this state is for — shown next to the switcher. */
  note: string;
  screen: ScreenName;
  /** Which note to open, for reading-mode scenarios. */
  notePath?: string;
  state: Partial<BackendState>;
}

const PATHS = {
  pricing: "C:\\Users\\you\\Documents\\TRACE\\2026-09-02 Pricing page rework.md",
  standup: "C:\\Users\\you\\Documents\\TRACE\\2026-09-01 Monday standup.md",
  catchup: "C:\\Users\\you\\Documents\\TRACE\\2026-09-03 Catch-up with Dev.md",
  planning: "C:\\Users\\you\\Documents\\TRACE\\2026-08-28 Quarterly planning.md",
} as const;

const BODIES: Record<string, string> = {
  [PATHS.pricing]: NOTE_ENHANCED,
  [PATHS.standup]: NOTE_RAW,
  [PATHS.catchup]: NOTE_NOTHING,
  [PATHS.planning]: NOTE_LONG,
};

/** Dates are relative to today so the library's grouping is exercised. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const NOTES: NoteSummary[] = [
  { path: PATHS.catchup, title: "Catch-up with Dev", date: isoDaysAgo(0), type: "general" },
  { path: PATHS.pricing, title: "Pricing page rework", date: isoDaysAgo(1), type: "design-review" },
  { path: PATHS.standup, title: "Monday standup", date: isoDaysAgo(3), type: "general" },
  { path: PATHS.planning, title: "Quarterly planning", date: isoDaysAgo(12), type: "general" },
  {
    path: "C:\\Users\\you\\Documents\\TRACE\\2026-07-14 Acme discovery.md",
    title: "Acme discovery call",
    date: isoDaysAgo(53),
    type: "discovery",
  },
];

const POPULATED: Partial<BackendState> = { notes: NOTES, bodies: BODIES };

/**
 * Segments arriving as they do during a real meeting.
 *
 * The first few land immediately, so a screen that mounts mid-meeting shows a
 * transcript that already has history — which is what a real one looks like
 * fourteen minutes in. The rest arrive on the chunker's rhythm.
 */
function liveScript(): ScriptedEvent[] {
  const turns: Array<[string, string]> = [
    ["system", "so where did we land on the migration"],
    ["microphone", "we said end of the month, but that was before the auth work"],
    ["system", "and now?"],
    ["microphone", "realistically the second week"],
    ["system", "does that touch anything customer facing"],
    ["microphone", "no, those were always quarter end"],
    ["system", "then I am not worried about it"],
    ["microphone", "it looks worse on the board than it is"],
    ["system", "can we split it so the visible half ships on time"],
    ["microphone", "possibly. The read path is separable"],
    ["system", "cost that out before you commit to it"],
    ["microphone", "I will have numbers by Thursday"],
  ];

  const BACKLOG = 7;

  return turns.map(([source, text], i) => ({
    // Backlog lands in the first 250ms; the rest keep arriving so the
    // transcript is visibly live rather than a static screenshot.
    atMs: i < BACKLOG ? i * 35 : 250 + (i - BACKLOG + 1) * 3200,
    event: EVENT.segment,
    payload: {
      id: `seg_${String(i).padStart(4, "0")}`,
      startMs: i * 4000,
      endMs: i * 4000 + 3400,
      text,
      source,
    },
  }));
}

export const SCENARIOS: Scenario[] = [
  /* --- Library ---------------------------------------------------- */
  {
    id: "library",
    name: "Meetings",
    group: "Library",
    note: "Several meetings across every date group.",
    screen: "library",
    state: POPULATED,
  },
  {
    id: "library-empty",
    name: "No meetings yet",
    group: "Library",
    note: "First thing a new user sees.",
    screen: "library",
    state: {},
  },
  {
    id: "library-recovery",
    name: "Interrupted meeting",
    group: "Library",
    note: "TRACE was killed mid-meeting. This is the only screen where work can still be lost.",
    screen: "library",
    state: {
      ...POPULATED,
      recoverable: [
        {
          sessionDir: "C:\\Users\\you\\AppData\\Local\\TRACE\\sessions\\20260905-1102",
          title: "Client call",
          date: isoDaysAgo(0),
          segmentCount: 148,
          noteLength: 412,
          corruptLines: 2,
        },
      ],
    },
  },

  /* --- Capture ----------------------------------------------------- */
  {
    id: "capture-live",
    name: "Recording",
    group: "Capture",
    note: "Fourteen minutes in. Meters moving, segments still arriving.",
    screen: "capture",
    state: { ...POPULATED, recording: true, startElapsedMs: 14 * 60_000, script: liveScript() },
  },
  {
    id: "capture-processing",
    name: "Transcribing",
    group: "Capture",
    note: "The gap between speech and transcript, labelled. Braille spinner, buffered seconds.",
    screen: "capture",
    state: {
      ...POPULATED,
      recording: true,
      startElapsedMs: 6 * 60_000,
      script: liveScript(),
      statusOverrides: { inFlight: 2, pendingSpeechMs: 3400 },
    },
  },
  {
    id: "capture-listening",
    name: "Listening",
    group: "Capture",
    note: "Speech held in the chunker but nothing in inference yet — the other half of the indicator.",
    screen: "capture",
    state: {
      ...POPULATED,
      recording: true,
      startElapsedMs: 2 * 60_000 + 12_000,
      script: liveScript(),
      statusOverrides: { inFlight: 0, pendingSpeechMs: 5200 },
    },
  },
  {
    id: "capture-setup",
    name: "Before recording",
    group: "Capture",
    note: "Device pick and title. Press Start to enter the live state for real.",
    screen: "capture",
    state: {
      ...POPULATED,
      startElapsedMs: 14 * 60_000,
      script: liveScript(),
      scriptStartsOn: "capture",
    },
  },
  {
    id: "capture-no-model",
    name: "Recording without a model",
    group: "Capture",
    note: "Audio is still captured. Only the transcript is missing — the screen has to say so.",
    screen: "capture",
    state: {
      ...POPULATED,
      recording: true,
      startElapsedMs: 3 * 60_000,
      model: {
        installed: false,
        name: "parakeet-tdt-0.6b-v3-int8",
        downloadBytes: 680 * 1_048_576,
        directory: "C:\\Users\\you\\AppData\\Local\\TRACE\\models",
      },
    },
  },
  {
    id: "capture-dropped",
    name: "Audio dropped",
    group: "Capture",
    note: "The live transcript has holes the final pass will not. Warning, not error.",
    screen: "capture",
    state: {
      ...POPULATED,
      recording: true,
      startElapsedMs: 22 * 60_000,
      script: liveScript(),
      statusOverrides: { droppedAudio: true, inFlight: 2, pendingSpeechMs: 5400 },
    },
  },
  {
    id: "capture-error",
    name: "A stream failed",
    group: "Capture",
    note: "One device died mid-meeting. The other keeps recording.",
    screen: "capture",
    state: {
      ...POPULATED,
      recording: true,
      startElapsedMs: 8 * 60_000,
      script: liveScript(),
      immediate: [
        {
          atMs: 0,
          event: EVENT.captureError,
          payload: { source: "system", message: "device disconnected" },
        },
      ],
    },
  },

  /* --- Reading ----------------------------------------------------- */
  {
    id: "note-enhanced",
    name: "Enhanced note",
    group: "Reading",
    note: "Both halves present. The toggle is the thing to judge here.",
    screen: "note",
    notePath: PATHS.pricing,
    state: POPULATED,
  },
  {
    id: "note-raw",
    name: "Never enhanced",
    group: "Reading",
    note: "Typed notes and a transcript, no generated half. Opens on My notes.",
    screen: "note",
    notePath: PATHS.standup,
    state: POPULATED,
  },
  {
    id: "note-nothing",
    name: "Nothing to extract",
    group: "Reading",
    note: "A correct empty result. Should read as considered, not broken.",
    screen: "note",
    notePath: PATHS.catchup,
    state: POPULATED,
  },
  {
    id: "note-long",
    name: "Ninety-minute meeting",
    group: "Reading",
    note: "320 transcript turns. The real test of whether mono type survives length.",
    screen: "note",
    notePath: PATHS.planning,
    state: POPULATED,
  },
  {
    id: "note-synthesising",
    name: "Notes being written",
    group: "Reading",
    note: "Re-transcribe, then synthesis across three windows, then the result.",
    screen: "note",
    notePath: PATHS.pricing,
    state: {
      ...POPULATED,
      script: [
        {
          atMs: 900,
          event: EVENT.transcriptUpdated,
          payload: { notePath: PATHS.pricing, segments: 148 },
        },
        { atMs: 2600, event: EVENT.synthesisProgress, payload: { window: 1, total: 3 } },
        { atMs: 5200, event: EVENT.synthesisProgress, payload: { window: 2, total: 3 } },
        { atMs: 7800, event: EVENT.synthesisProgress, payload: { window: 3, total: 3 } },
        {
          atMs: 10_400,
          event: EVENT.notesGenerated,
          payload: { notePath: PATHS.pricing, dropped: 0, fabricated: 0, uncited: 0 },
        },
      ],
    },
  },
  {
    id: "note-dropped",
    name: "Fabrications discarded",
    group: "Reading",
    note: "The model invented two items and validation dropped them. The user is told.",
    screen: "note",
    notePath: PATHS.pricing,
    state: {
      ...POPULATED,
      script: [
        {
          atMs: 900,
          event: EVENT.notesGenerated,
          payload: { notePath: PATHS.pricing, dropped: 2, fabricated: 2, uncited: 0 },
        },
      ],
    },
  },
  {
    id: "note-failed",
    name: "Synthesis failed",
    group: "Reading",
    note: "Ollama was not running. The transcript and typed notes are intact.",
    screen: "note",
    notePath: PATHS.standup,
    state: {
      ...POPULATED,
      script: [
        {
          atMs: 900,
          event: EVENT.synthesisFailed,
          payload: { message: "could not reach ollama at 127.0.0.1:11434" },
        },
      ],
    },
  },
  {
    id: "note-unreplayable",
    name: "Cannot be regenerated",
    group: "Reading",
    note: "An older note whose journal is gone. The control says so rather than failing when pressed.",
    screen: "note",
    notePath: PATHS.pricing,
    state: { ...POPULATED, canRegenerate: false },
  },
  {
    id: "note-missing",
    name: "Note will not open",
    group: "Reading",
    note: "The file was moved or deleted outside TRACE.",
    screen: "note",
    notePath: "C:\\Users\\you\\Documents\\TRACE\\gone.md",
    state: POPULATED,
  },

  /* --- First run --------------------------------------------------- */
  {
    id: "first-run",
    name: "No speech model",
    group: "First run",
    note: "The download is unavoidable, so it is the honest home for the boot sequence.",
    screen: "library",
    state: {
      model: {
        installed: false,
        name: "parakeet-tdt-0.6b-v3-int8",
        downloadBytes: 680 * 1_048_576,
        directory: "C:\\Users\\you\\AppData\\Local\\TRACE\\models",
      },
    },
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
