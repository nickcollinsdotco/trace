import type { Page } from "../../app/Sidebar";

/**
 * What the narrator says (CONTEXT.md, docs/13 Q17).
 *
 * Deadpan machine output: events and counts, stated exactly, funny only
 * because it is so literal. Never a word of what anyone said — the same
 * rule diagnostics.rs keeps for the log. Pure, so every line can be tested.
 */
/**
 * What each theme is, said as the narrator says everything: flatly, in a
 * few words, never about what anyone said.
 */
const THEME_LINES: Record<string, string> = {
  carbon: "the default, pressed and starched.",
  report: "minutes, as they ought to be kept.",
  industrial: "heavy plant. mind your fingers.",
  termcn: "every colour at full volume.",
  graphite: "quiet greys. nothing but the words.",
  shell: "amber, the way the night shift had it.",
  index: "everything filed. nothing lost.",
  vault: "rations counted. notes kept.",
  teletext: "page 100. meetings on 101.",
  scope: "signal acquired.",
};

/** The capitals ladder, step by step, from a narrator who notices. */
const CASE_LINES: Record<string, string> = {
  none: "capitals: none. inside voices.",
  labels: "capitals: labels. a quiet authority.",
  controls: "capitals: controls. the buttons have opinions now.",
  headings: "capitals: headings. shouting enabled.",
};

export type NarratorEvent =
  | { kind: "page"; page: Page }
  | { kind: "theme"; theme: string }
  /** The capitals ladder moved, on the same theme. */
  | { kind: "case"; step: string }
  | { kind: "started"; hour: number }
  | { kind: "stopped"; elapsedMs: number; segments: number }
  | { kind: "segments"; count: number }
  | { kind: "crosstalk" }
  | { kind: "quiet" }
  | { kind: "idle"; notes: number | null; tick: number }
  /** Coming on: at launch, or switched on. */
  | { kind: "online" }
  /** Fun mode switched on, or off. */
  | { kind: "awake" }
  | { kind: "asleep" }
  /** The clock reached the hour. */
  | { kind: "hour"; hour: number }
  /** The narrator was clicked, this many times in a row. */
  | { kind: "poke"; count: number };

const PAGE_LINES: Record<Page, string> = {
  library: "meetings. all of them on this machine.",
  capture: "ready when you are.",
  models: "models. the parts that do the listening.",
  appearance: "appearance. no change is permanent.",
  settings: "settings. read twice, change once.",
  about: "about. a short document about ourselves.",
};

/*
 * Idle thoughts, mixed in with the plain reports: machine thoughts and boot
 * quotes (docs/09 §11, §17), a little ASCII, and now and then a hint at a
 * secret. Plain ASCII, for the same reason as the palette's drawings.
 */
const FUN_IDLE = [
  "> noise filtered. signal retained.",
  "...__.-'^'-.__..  carrier steady.",
  "signal over noise.",
  "[OK] local index. [OK] context buffer. [--] awaiting session.",
  "conversations leave traces.",
  "psst. ctrl+k, then: trace --why",
  "remember what matters.",
  "defragmenting nothing. [##########] done.",
  ">_",
  "the wordmark likes to be clicked. seven times.",
  "memory ok. 64K+ free.",
  "up up down down left right left right b a. just saying.",
  "context restored.",
  "type trace anywhere. not in a field.",
];

/** Idle lines, taken in turn. None claims the microphone is open: it is not. */
function idleLine(notes: number | null, tick: number): string {
  // Every other remark is a thought rather than a report.
  if (tick % 2 === 1) return FUN_IDLE[Math.floor(tick / 2) % FUN_IDLE.length] ?? ">_";
  const plain = Math.floor(tick / 2);
  const lines = [
    "idle. microphone closed.",
    notes === null ? "nothing to report." : `${notes} ${notes === 1 ? "trace" : "traces"} on file.`,
    "nothing left this machine today.",
    "still here.",
    notes === null || notes === 0
      ? "no meetings yet. no hurry."
      : "every one of them has a timestamp.",
  ];
  return lines[plain % lines.length] ?? "still here.";
}

/** The hour, said. Most hours are just the hour. */
const HOUR_LINES: Record<number, string> = {
  0: "a new day, technically.",
  9: "the first standup of the day, statistically.",
  12: "lunch. the microphone is closed for it.",
  15: "the slump. nothing scheduled about it.",
  17: "one more meeting, said nobody.",
};

/** Poked, the narrator answers — and if poked enough, gives something up. */
const POKES = [
  "yes?",
  "input received.",
  "still here.",
  "that does nothing. it will keep doing nothing.",
  "persistence noted.",
  "fine. ctrl+k, then: trace --help",
];

export function narrate(event: NarratorEvent): string {
  switch (event.kind) {
    case "page":
      return PAGE_LINES[event.page];
    case "case":
      return CASE_LINES[event.step] ?? `capitals: ${event.step}.`;
    case "theme":
      return `theme: ${event.theme}. ${THEME_LINES[event.theme] ?? "same words, different light."}`;
    case "started":
      // After midnight and before dawn, the meeting gets a remark of its own.
      return event.hour < 5
        ? "recording. burning the midnight oil."
        : "recording. two channels open.";
    case "stopped": {
      const minutes = Math.max(1, Math.round(event.elapsedMs / 60_000));
      return `saved. ${minutes} min, ${event.segments} segments. writing notes.`;
    }
    case "segments":
      return `${event.count} segments. still listening.`;
    case "crosstalk":
      return "crosstalk detected. both channels at once.";
    case "quiet":
      return "…the room goes quiet.";
    case "idle":
      return idleLine(event.notes, event.tick);
    case "online":
      return "online. nothing leaves this machine.";
    case "awake":
      return "fun mode on. things may happen.";
    case "asleep":
      return "fun mode off. things will not happen.";
    case "hour": {
      const hh = String(event.hour).padStart(2, "0");
      return `${hh}:00. ${HOUR_LINES[event.hour] ?? "on the hour, exactly."}`;
    }
    case "poke":
      return POKES[Math.min(event.count, POKES.length) - 1] ?? "yes?";
  }
}

/**
 * How long after typing `prev` the next key lands, in milliseconds, given a
 * random 0–1. Quick inside a word, a beat at a space, a pause after
 * punctuation: a person at a keyboard, not a printer.
 */
export function keyDelay(prev: string, random: number): number {
  if (/[.!?]/.test(prev)) return 170 + random * 170;
  if (/[,:;]/.test(prev)) return 100 + random * 90;
  if (prev === " ") return 40 + random * 50;
  return 16 + random * 40;
}

/** Every hundred segments is worth a word; fewer would chatter. */
export function segmentMilestone(before: number, after: number): number | null {
  const crossed = Math.floor(after / 100);
  return crossed > Math.floor(before / 100) && crossed > 0 ? crossed * 100 : null;
}

/*
 * Listening to the levels, for the two remarks a meeting earns on its own.
 *
 * RMS, 0–1. Speech sits around 0.03–0.2 (−30 to −14 dBFS) and a quiet room
 * near 0.001, so "talking" is above −34 dBFS and "silent" below −48.
 */
const TALKING = 0.02;
const SILENT = 0.004;
/** Both talking this many polls in a row (a second apart) is crosstalk. */
const CROSSTALK_POLLS = 3;
/** And not again for this long: once is observation, twice is nagging. */
const CROSSTALK_REST_MS = 120_000;
const QUIET_MS = 30_000;

export interface Ear {
  overlap: number;
  quietSince: number | null;
  saidQuiet: boolean;
  lastCrosstalk: number;
}

export const freshEar = (): Ear => ({
  overlap: 0,
  quietSince: null,
  saidQuiet: false,
  lastCrosstalk: Number.NEGATIVE_INFINITY,
});

export function listen(
  ear: Ear,
  mic: number,
  system: number,
  now: number,
): { ear: Ear; heard: "crosstalk" | "quiet" | null } {
  let heard: "crosstalk" | "quiet" | null = null;
  const next = { ...ear };

  next.overlap = mic > TALKING && system > TALKING ? ear.overlap + 1 : 0;
  if (next.overlap >= CROSSTALK_POLLS && now - ear.lastCrosstalk > CROSSTALK_REST_MS) {
    heard = "crosstalk";
    next.lastCrosstalk = now;
    next.overlap = 0;
  }

  if (mic < SILENT && system < SILENT) {
    next.quietSince = ear.quietSince ?? now;
    if (!ear.saidQuiet && now - next.quietSince >= QUIET_MS) {
      heard = heard ?? "quiet";
      next.saidQuiet = true;
    }
  } else {
    // Anyone speaking ends the quiet, and the next one may be remarked on.
    next.quietSince = null;
    next.saidQuiet = false;
  }

  return { ear: next, heard };
}
