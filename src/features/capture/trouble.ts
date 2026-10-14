import { formatElapsed } from "../../components/ui/terminal";
import type { CaptureStatus, LostStream } from "../../lib/ipc";

/**
 * What is going wrong with the recording itself, said while the meeting is
 * still on. A full disk used to end a stream silently, and nobody knew until
 * the meeting was stopped and an hour of one side was missing.
 */
export interface Trouble {
  tone: "warn" | "error";
  /** The sentence for the recording screen. */
  message: string;
  /** A few words for the mini window, under the meeting's name. */
  short: string;
}

/** Below this, the disk warning is an error: there is no meeting left in it. */
const DISK_URGENT_MINUTES = 15;

/** A stream lost this early never really started. */
const START_GRACE_MS = 5_000;

const NAMES: Record<LostStream["source"], { long: string; short: string }> = {
  microphone: { long: "The microphone", short: "mic" },
  system: { long: "System audio", short: "system audio" },
};

/** Worst first, so the mini window can show only the first. */
export function troubles(status: CaptureStatus): Trouble[] {
  const found: Trouble[] = [];

  for (const lost of status.lostStreams) {
    const name = NAMES[lost.source];
    found.push({
      tone: "error",
      message:
        lost.atMs < START_GRACE_MS
          ? `${name.long} is not recording (${lost.reason}). The meeting goes on without it.`
          : `${name.long} stopped recording at ${formatElapsed(lost.atMs)} (${lost.reason}). What came before is kept; nothing after it is.`,
      short: `${name.short} stopped`,
    });
  }

  if (status.journalFailing) {
    found.push({
      tone: "error",
      message:
        "The live transcript is not being saved: writing it to disk failed. Audio is recorded separately, and the saved note is transcribed again from it.",
      short: "transcript not saving",
    });
  }

  const minutes = status.diskMinutesLeft;
  if (minutes !== null) {
    const urgent = minutes < DISK_URGENT_MINUTES;
    found.push({
      tone: urgent ? "error" : "warn",
      message:
        minutes === 0
          ? "The disk is full. Recording stops as soon as there is no room for the next second; free some space now."
          : `Room for about ${duration(minutes)} more recording on this disk. Free some space, or recording stops when it runs out.`,
      short: minutes === 0 ? "disk full" : `disk: ${duration(minutes)} left`,
    });
  }

  return found;
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const m = minutes % 60;
  return m === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}h ${m}m`;
}
