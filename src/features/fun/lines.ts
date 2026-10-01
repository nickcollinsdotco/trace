import type { Page } from "../../app/Sidebar";

/**
 * What the narrator says (CONTEXT.md, docs/13 Q17).
 *
 * Deadpan machine output: events and counts, stated exactly, funny only
 * because it is so literal. Never a word of what anyone said — the same
 * rule diagnostics.rs keeps for the log. Pure, so every line can be tested.
 */
export type NarratorEvent =
  | { kind: "page"; page: Page }
  | { kind: "theme"; theme: string }
  | { kind: "started"; hour: number }
  | { kind: "stopped"; elapsedMs: number; segments: number }
  | { kind: "segments"; count: number }
  | { kind: "crosstalk" }
  | { kind: "quiet" }
  | { kind: "idle"; notes: number | null; tick: number }
  | { kind: "awake" };

const PAGE_LINES: Record<Page, string> = {
  library: "meetings. all of them on this machine.",
  capture: "ready when you are.",
  models: "models. the parts that do the listening.",
  appearance: "appearance. no change is permanent.",
  settings: "settings. read twice, change once.",
  about: "about. a short document about ourselves.",
};

/** Idle lines, taken in turn. None claims the microphone is open: it is not. */
function idleLine(notes: number | null, tick: number): string {
  const lines = [
    "idle. microphone closed.",
    notes === null ? "nothing to report." : `${notes} ${notes === 1 ? "trace" : "traces"} on file.`,
    "nothing left this machine today.",
    "still here.",
    notes === null || notes === 0
      ? "no meetings yet. no hurry."
      : "every one of them has a timestamp.",
  ];
  return lines[tick % lines.length] ?? "still here.";
}

export function narrate(event: NarratorEvent): string {
  switch (event.kind) {
    case "page":
      return PAGE_LINES[event.page];
    case "theme":
      return `theme: ${event.theme}. same words, different light.`;
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
    case "awake":
      return "fun mode. the machine will now speak.";
  }
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
