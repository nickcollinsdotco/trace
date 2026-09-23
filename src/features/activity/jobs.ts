import type { Job, JobStep } from "../../lib/ipc";

/**
 * Reading a job the way the screens describe it.
 *
 * Kept apart from the components so the wording — which is most of what these
 * indicators are — can be tested without rendering anything.
 */

export function isRunning(job: Job): boolean {
  return job.outcome === null;
}

/** Queued: accepted, but waiting for another job to free the lane. */
export function isQueued(job: Job): boolean {
  return job.outcome === null && job.steps.every((s) => s.startedAt === null);
}

export function currentStep(job: Job): JobStep | null {
  return job.steps.find((s) => s.startedAt !== null && s.finishedAt === null) ?? null;
}

/**
 * What a step is called in a list of steps.
 *
 * `parts` is how many the meeting was split into. The final pass also runs
 * on a meeting of one part when it produced too many key points, and then
 * it is choosing among them, not combining anything.
 */
export function stepLabel(step: JobStep, parts = 0): string {
  switch (step.kind) {
    case "transcript":
      return "full-quality transcript";
    case "notes":
      return "write notes";
    case "part":
      return step.total === 1 ? "write notes" : `part ${step.index} of ${step.total}`;
    case "combine":
      return parts > 1 ? "combine into one summary" : "choose the key points";
  }
}

/**
 * One line for what a running job is doing now.
 *
 * Says what is happening rather than which step number it is: "part 8 of 8"
 * left on screen through the combining pass read as stuck.
 */
export function headline(job: Job): string {
  if (isQueued(job)) return "waiting for another meeting's notes";
  const step = currentStep(job);
  if (step === null) return "writing notes";
  switch (step.kind) {
    case "transcript":
      return "refining the transcript";
    case "notes":
      return "writing notes";
    case "part":
      return step.total === 1
        ? "writing notes"
        : `writing notes, part ${step.index} of ${step.total}`;
    case "combine": {
      const parts = partsTotal(job);
      return parts > 1 ? `combining ${parts} parts` : "choosing the key points";
    }
  }
}

export function partsTotal(job: Job): number {
  const part = job.steps.find((s) => s.kind === "part");
  return part?.kind === "part" ? part.total : 0;
}

/**
 * Parts written out of how many, for a meeting long enough to be split.
 *
 * Null for a single part: one request has no honest fraction, and a bar that
 * sat at zero then jumped to full would say less than a spinner.
 */
export function partsDone(job: Job): { done: number; total: number } | null {
  const total = partsTotal(job);
  if (total < 2) return null;
  const done = job.steps.filter(
    (s) => s.kind === "part" && s.finishedAt !== null && !s.failed,
  ).length;
  return { done, total };
}

/** When the job started working, not when it was queued. */
export function startedAt(job: Job): number | null {
  return job.steps.find((s) => s.startedAt !== null)?.startedAt ?? null;
}

/** "38s", "1m 12s", "1h 03m" — short enough for a status bar. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
