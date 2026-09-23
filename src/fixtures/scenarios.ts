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

import { EVENT, type Job, type JobOutcome, type NoteSummary, type StepKind } from "../lib/ipc";
import type { BackendState, ScriptedEvent } from "./backend";
import {
  NOTE_ENHANCED,
  NOTE_FRESH,
  NOTE_LONG,
  NOTE_NOTHING,
  NOTE_RAW,
  NOTE_TRANSCRIPT_ONLY,
} from "./notes";

export type ScreenName =
  | "library"
  | "capture"
  | "note"
  | "firstrun"
  | "models"
  | "appearance"
  | "settings"
  | "about";

export interface Scenario {
  id: string;
  name: string;
  group: "Library" | "Capture" | "Reading" | "First run" | "Pages";
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
  vendor: "C:\\Users\\you\\Documents\\TRACE\\2026-09-04 Vendor call — Northwind.md",
} as const;

const BODIES: Record<string, string> = {
  [PATHS.pricing]: NOTE_ENHANCED,
  [PATHS.standup]: NOTE_RAW,
  [PATHS.catchup]: NOTE_NOTHING,
  [PATHS.planning]: NOTE_LONG,
  [PATHS.vendor]: NOTE_TRANSCRIPT_ONLY,
};

/** Dates are relative to today so the library's grouping is exercised. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** When a fixture meeting started: `days` ago at `hour` o'clock, local. */
function startedDaysAgo(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const MINUTE = 60_000;

/*
 * Gists on some notes and not others, as a real library has: anything
 * recorded before gists existed, or while Ollama was closed, has none.
 */
const NOTES: NoteSummary[] = [
  {
    path: PATHS.catchup,
    title: "Catch-up with Dev",
    date: isoDaysAgo(0),
    type: "general",
    gist: "An informal catch-up with Dev about the week; nothing was decided.",
    tags: [],
    startedAt: startedDaysAgo(0, 16),
    durationMs: 18 * MINUTE,
  },
  {
    path: PATHS.pricing,
    title: "Pricing page rework",
    date: isoDaysAgo(1),
    type: "design-review",
    gist: "The team reviewed the current pricing page and agreed it is doing too much at once.",
    tags: [],
    startedAt: startedDaysAgo(1, 14),
    durationMs: 47 * MINUTE,
  },
  {
    path: PATHS.vendor,
    title: "Vendor call — Northwind",
    date: isoDaysAgo(2),
    type: "client",
    gist: null,
    tags: [],
    startedAt: startedDaysAgo(2, 11),
    durationMs: null,
  },
  {
    path: PATHS.standup,
    title: "Monday standup",
    date: isoDaysAgo(3),
    type: "general",
    gist: null,
    tags: [],
    startedAt: startedDaysAgo(3, 9),
    durationMs: 12 * MINUTE,
  },
  {
    path: PATHS.planning,
    title: "Quarterly planning",
    date: isoDaysAgo(12),
    type: "general",
    gist: "Quarterly planning across three teams, settling the roadmap and who owns the migration, with hiring left open.",
    tags: [],
    startedAt: startedDaysAgo(12, 10),
    durationMs: 94 * MINUTE,
  },
  {
    path: "C:\\Users\\you\\Documents\\TRACE\\2026-07-14 Acme discovery.md",
    title: "Acme discovery call",
    date: isoDaysAgo(53),
    type: "discovery",
    gist: "A first call with Acme to understand how their support team triages tickets.",
    tags: [],
    startedAt: startedDaysAgo(53, 15),
    durationMs: 38 * MINUTE,
  },
];

/** A few tags, so tag filtering is something you can actually look at. */
const TAGS: Record<string, string[]> = {
  [PATHS.pricing]: ["client", "pricing"],
  [PATHS.planning]: ["planning"],
  [PATHS.standup]: ["internal"],
};

const POPULATED: Partial<BackendState> = { notes: NOTES, bodies: BODIES, tags: TAGS };

/** A step, with when it started and finished on the scenario's own clock. */
interface StepAt {
  step: StepKind;
  from?: number;
  to?: number;
  failed?: boolean;
  /** Why it failed, when the job carried on without it. */
  error?: string;
}

/**
 * A job as the backend lists it `at` a moment in the scenario.
 *
 * Steps are written against one clock for the whole scenario and converted
 * to "ms ago" for the moment the snapshot is sent, which is what the fixture
 * backend expects — so a timeline reads as a timeline.
 */
function jobAt(
  at: number,
  job: { id: number; notePath: string; title: string; queuedAt?: number },
  steps: StepAt[],
  outcome: JobOutcome | null = null,
): Job {
  const rel = (t: number | undefined) => (t === undefined ? null : t - at);
  return {
    id: job.id,
    notePath: job.notePath,
    title: job.title,
    queuedAt: (job.queuedAt ?? 0) - at,
    steps: steps.map((s) => ({
      ...s.step,
      startedAt: rel(s.from),
      finishedAt: rel(s.to),
      failed: s.failed ?? s.error !== undefined,
      error: s.error ?? null,
    })),
    outcome,
  };
}

const PART = (index: number, total = 3): StepKind => ({ kind: "part", index, total });
const PRICING_JOB = { id: 1, notePath: PATHS.pricing, title: "Pricing page rework" };

/** One meeting's notes part-way written, and the next meeting's waiting. */
const QUEUED: Job[] = [
  jobAt(0, { ...PRICING_JOB, queuedAt: -95_000 }, [
    { step: { kind: "transcript" }, from: -95_000, to: -58_000 },
    { step: PART(1), from: -58_000, to: -21_000 },
    { step: PART(2), from: -21_000 },
    { step: PART(3) },
    { step: { kind: "combine" } },
  ]),
  jobAt(0, { id: 2, notePath: PATHS.vendor, title: "Vendor call — Northwind", queuedAt: -8_000 }, [
    { step: { kind: "transcript" } },
    { step: { kind: "notes" } },
  ]),
];

/**
 * A meeting ending and its notes being written, start to finish: queued,
 * the full-quality transcript, three parts, the combining pass, done.
 */
function writingScript(): ScriptedEvent[] {
  // When each stage starts on the scenario's clock; each ends as the next begins.
  const T = 400;
  const P1 = 2_600;
  const P2 = 5_200;
  const P3 = 7_800;
  const C = 9_400;
  const D = 11_400;

  const snap = (at: number, outcome: JobOutcome | null = null): ScriptedEvent => {
    const span = (step: StepKind, from: number, to: number): StepAt => ({
      step,
      ...(at >= from && { from }),
      ...(at >= to && { to }),
    });
    // The parts are only known once the transcript is done and the meeting
    // has been split, exactly as the backend reports it.
    const steps =
      at < P1
        ? [span({ kind: "transcript" }, T, P1), { step: { kind: "notes" } as StepKind }]
        : [
            span({ kind: "transcript" }, T, P1),
            span(PART(1), P1, P2),
            span(PART(2), P2, P3),
            span(PART(3), P3, C),
            span({ kind: "combine" }, C, D),
          ];
    return { atMs: at, event: EVENT.activity, payload: [jobAt(at, PRICING_JOB, steps, outcome)] };
  };

  return [
    snap(0),
    snap(T),
    {
      atMs: P1,
      event: EVENT.transcriptUpdated,
      payload: { notePath: PATHS.pricing, segments: 148 },
    },
    snap(P1),
    snap(P2),
    snap(P3),
    snap(C),
    { atMs: D, event: EVENT.notesGenerated, payload: { notePath: PATHS.pricing } },
    snap(D, { state: "generated", dropped: 0, fabricated: 0, uncited: 0 }),
  ];
}

/**
 * The full-quality pass failing, and the notes being written from the live
 * transcript anyway — rather than the job stopping and leaving the user to
 * find "Generate summary", which would produce the same notes.
 */
function liveFallbackScript(): ScriptedEvent[] {
  const T = 400;
  const F = 2_200; // the pass fails; notes start
  const D = 6_400;
  const reason = "the transcription model did not load (encoder-model.int8.onnx is missing)";

  const snap = (at: number, outcome: JobOutcome | null = null): ScriptedEvent => {
    const steps: StepAt[] =
      at < F
        ? [
            { step: { kind: "transcript" }, ...(at >= T && { from: T }) },
            { step: { kind: "notes" } },
          ]
        : [
            { step: { kind: "transcript" }, from: T, to: F, error: reason },
            { step: PART(1, 1), from: F, ...(at >= D && { to: D }) },
          ];
    return { atMs: at, event: EVENT.activity, payload: [jobAt(at, PRICING_JOB, steps, outcome)] };
  };

  return [
    snap(0),
    snap(T),
    snap(F),
    { atMs: D, event: EVENT.notesGenerated, payload: { notePath: PATHS.pricing } },
    snap(D, { state: "generated", dropped: 0, fabricated: 0, uncited: 0 }),
  ];
}

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

  {
    id: "library-ollama-closed",
    name: "Ollama closed",
    group: "Library",
    note: "Ollama was quit. Said before a meeting, not discovered after one. Open Ollama clears it.",
    screen: "library",
    state: { ...POPULATED, llm: { state: "not_running" } },
  },
  {
    id: "library-no-model",
    name: "Ollama has no model",
    group: "Library",
    note: "Running, but nothing pulled. A different fix, so a different message.",
    screen: "library",
    state: {
      ...POPULATED,
      llm: { state: "no_model", suggested: "qwen3:8b" },
      summaryInstalled: [],
    },
  },

  {
    id: "library-working",
    name: "Working in the background",
    group: "Library",
    note: "A meeting just ended. The status bar shows its notes being written; when they finish, a toast says so, because nothing on this screen would.",
    screen: "library",
    state: { ...POPULATED, script: writingScript() },
  },
  {
    id: "library-queued",
    name: "Two meetings queued",
    group: "Library",
    note: "Back-to-back meetings. One is written at a time; the status bar says the other is waiting.",
    screen: "library",
    state: { ...POPULATED, activity: QUEUED },
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
    id: "note-context",
    name: "Context and a name given",
    group: "Reading",
    note: "The user said what the meeting was and who THEM was. The name replaces THEM in the transcript at once; Edit opens the form, with Save and regenerate.",
    screen: "note",
    notePath: PATHS.catchup,
    state: {
      ...POPULATED,
      contexts: {
        [PATHS.catchup]: {
          context: "Weekly one-to-one with Dev, who joined the design team last month.",
          participants: ["Dev"],
        },
      },
    },
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
    id: "note-transcript-only",
    name: "No notes, no summary",
    group: "Reading",
    note: "Nothing typed and Ollama closed at the end. Opens on the summary side, offering to generate one.",
    screen: "note",
    notePath: PATHS.vendor,
    state: { ...POPULATED, llm: { state: "not_running" } },
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
    note: "Just ended: placeholders where the summary will be, then the transcript refined, three parts, the combining pass, and the note filling in. Open the line for the steps.",
    screen: "note",
    notePath: PATHS.pricing,
    state: {
      ...POPULATED,
      bodies: { ...BODIES, [PATHS.pricing]: NOTE_FRESH },
      afterGenerate: { [PATHS.pricing]: NOTE_ENHANCED },
      script: writingScript(),
    },
  },
  {
    id: "note-live-fallback",
    name: "Full-quality pass failed",
    group: "Reading",
    note: "The re-transcription could not run. Notes are written from the live transcript anyway, and the line says so; open it for why.",
    screen: "note",
    notePath: PATHS.pricing,
    state: {
      ...POPULATED,
      bodies: { ...BODIES, [PATHS.pricing]: NOTE_FRESH },
      afterGenerate: { [PATHS.pricing]: NOTE_ENHANCED },
      script: liveFallbackScript(),
    },
  },
  {
    id: "note-regenerating",
    name: "Regenerating",
    group: "Reading",
    note: "Notes written again over existing ones. The old ones stay, dimmed, until the new ones land; ↻ is disabled.",
    screen: "note",
    notePath: PATHS.pricing,
    state: {
      ...POPULATED,
      activity: [
        jobAt(0, PRICING_JOB, [
          { step: PART(1), from: -48_000, to: -17_000 },
          { step: PART(2), from: -17_000 },
          { step: PART(3) },
          { step: { kind: "combine" } },
        ]),
      ],
    },
  },
  {
    id: "note-queued",
    name: "Waiting its turn",
    group: "Reading",
    note: "This meeting ended while another's notes were being written. It says it is waiting, not stuck.",
    screen: "note",
    notePath: PATHS.vendor,
    state: { ...POPULATED, activity: QUEUED },
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
      activity: [
        jobAt(
          0,
          PRICING_JOB,
          [
            { step: { kind: "transcript" }, from: -140_000, to: -101_000 },
            { step: PART(1, 1), from: -101_000, to: -52_000 },
          ],
          { state: "generated", dropped: 2, fabricated: 2, uncited: 0 },
        ),
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
      activity: [
        jobAt(
          0,
          { id: 1, notePath: PATHS.standup, title: "Monday standup" },
          [
            { step: { kind: "transcript" }, from: -40_000, to: -12_000 },
            { step: { kind: "notes" }, from: -12_000, to: -11_900, failed: true },
          ],
          {
            state: "failed",
            message:
              "Ollama is not running, so notes could not be written. Open Ollama and try again",
          },
        ),
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
    id: "first-run-report",
    name: "Machine report",
    group: "First run",
    note: "The setup screen. Every row is measured — this is what the app knows about the machine.",
    screen: "firstrun",
    state: {
      model: {
        installed: false,
        name: "parakeet-tdt-0.6b-v3-int8",
        downloadBytes: 680 * 1_048_576,
        directory: "C:UsersyouAppDataLocalTRACEmodels",
      },
    },
  },
  {
    id: "first-run-downloading",
    name: "Downloading",
    group: "First run",
    note: "Dithered gauge in the TR-100 idiom. Track is a checkerboard, fill is solid.",
    screen: "firstrun",
    state: {
      model: {
        installed: false,
        name: "parakeet-tdt-0.6b-v3-int8",
        downloadBytes: 680 * 1_048_576,
        directory: "C:UsersyouAppDataLocalTRACEmodels",
      },
      immediate: [
        { atMs: 0, event: EVENT.modelProgress, payload: { phase: "downloading", percent: 47 } },
      ],
    },
  },
  {
    id: "first-run-failed",
    name: "Setup failed",
    group: "First run",
    note: "No network. The message says what to do, not what the socket returned.",
    screen: "firstrun",
    state: {
      model: {
        installed: false,
        name: "parakeet-tdt-0.6b-v3-int8",
        downloadBytes: 680 * 1_048_576,
        directory: "C:UsersyouAppDataLocalTRACEmodels",
      },
      failures: {
        install_model:
          "No internet connection. TRACE downloads the speech model once — after that it works entirely offline. (download failed: https://blob.handy.computer/parakeet-v3-int8.tar.gz: Dns Failed)",
      },
    },
  },
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

  /* --- Pages ------------------------------------------------------- */
  {
    id: "models",
    name: "Models",
    group: "Pages",
    note: "Both kinds of model: speech (TRACE's own files) and summaries (Ollama's).",
    screen: "models",
    state: POPULATED,
  },
  {
    id: "models-ollama-closed",
    name: "Models, Ollama closed",
    group: "Pages",
    note: "Speech models still manageable; summaries say how to get Ollama back.",
    screen: "models",
    state: { ...POPULATED, llm: { state: "not_running" } },
  },
  {
    id: "models-none-pulled",
    name: "Models, nothing in Ollama",
    group: "Pages",
    note: "Ollama running with no model. The downloads are the fix, so no terminal command is shown.",
    screen: "models",
    state: {
      ...POPULATED,
      llm: { state: "no_model", suggested: "qwen3:8b" },
      summaryInstalled: [],
    },
  },
  {
    id: "appearance",
    name: "Appearance",
    group: "Pages",
    note: "Every theme previewed with its own tokens. Picking one here re-themes this preview.",
    screen: "appearance",
    state: POPULATED,
  },
  {
    id: "settings",
    name: "Settings",
    group: "Pages",
    note: "Only the settings that change what happens to a meeting.",
    screen: "settings",
    state: POPULATED,
  },
  {
    id: "about",
    name: "About",
    group: "Pages",
    note: "Version, folders, and the diagnostics report with its recent events.",
    screen: "about",
    state: POPULATED,
  },
  {
    id: "about-model-held",
    name: "About, notes being written",
    group: "Pages",
    note: "The report while TRACE holds the summary model: what it occupies, and how much is on the GPU. Idle, nothing is held.",
    screen: "about",
    state: { ...POPULATED, activity: QUEUED },
  },
  {
    id: "about-ollama-closed",
    name: "About, Ollama closed",
    group: "Pages",
    note: "The report in the state most worth diagnosing: summaries offline, nothing in memory.",
    screen: "about",
    state: {
      ...POPULATED,
      llm: { state: "not_running" },
      recentLog: [
        "2026-09-23 10:41:38 meeting ended: 412 live segments, 0 characters of notes",
        "2026-09-23 10:44:02 summary failed: Ollama is not running, so notes could not be written. Open Ollama and try again",
      ],
    },
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
