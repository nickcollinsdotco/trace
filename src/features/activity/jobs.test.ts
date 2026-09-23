import { describe, expect, it } from "vitest";
import type { Job, JobStep, StepKind } from "../../lib/ipc";
import { currentStep, formatDuration, headline, isQueued, partsDone, stepLabel } from "./jobs";

function step(kind: StepKind, from: number | null = null, to: number | null = null): JobStep {
  return { ...kind, startedAt: from, finishedAt: to, failed: false };
}

function job(steps: JobStep[], outcome: Job["outcome"] = null): Job {
  return { id: 1, notePath: "a.md", title: "A", queuedAt: 0, steps, outcome };
}

const part = (index: number, total: number): StepKind => ({ kind: "part", index, total });

describe("jobs", () => {
  it("treats a job with no step started as queued", () => {
    const queued = job([step({ kind: "transcript" }), step({ kind: "notes" })]);
    expect(isQueued(queued)).toBe(true);
    expect(currentStep(queued)).toBeNull();
    expect(headline(queued)).toBe("waiting for another meeting's notes");
  });

  it("names a single part as the whole job, not 'part 1 of 1'", () => {
    expect(stepLabel(step(part(1, 1)))).toBe("write notes");
    expect(headline(job([step(part(1, 1), 1)]))).toBe("writing notes");
    expect(stepLabel(step(part(2, 5)))).toBe("part 2 of 5");
  });

  it("does not call the final pass on a one-part meeting 'combining'", () => {
    // It runs there only to cut too many key points down.
    const single = job([step(part(1, 1), 1, 2), step({ kind: "combine" }, 2)]);
    expect(headline(single)).toBe("choosing the key points");
    expect(stepLabel(step({ kind: "combine" }), 1)).toBe("choose the key points");

    const split = job([step(part(3, 3), 1, 2), step({ kind: "combine" }, 2)]);
    expect(headline(split)).toBe("combining 3 parts");
    expect(stepLabel(step({ kind: "combine" }), 3)).toBe("combine into one summary");
  });

  it("describes the transcript pass as what it is doing", () => {
    expect(headline(job([step({ kind: "transcript" }, 1), step({ kind: "notes" })]))).toBe(
      "refining the transcript",
    );
  });

  it("counts only parts that finished, and only for a split meeting", () => {
    const failed = { ...step(part(2, 3), 2, 3), failed: true };
    expect(partsDone(job([step(part(1, 3), 1, 2), failed, step(part(3, 3))]))).toEqual({
      done: 1,
      total: 3,
    });
    // One request has no honest fraction.
    expect(partsDone(job([step(part(1, 1), 1)]))).toBeNull();
    expect(partsDone(job([step({ kind: "notes" }, 1)]))).toBeNull();
  });

  it("formats durations short enough for a status bar", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(38_400)).toBe("38s");
    expect(formatDuration(72_000)).toBe("1m 12s");
    expect(formatDuration(3_780_000)).toBe("1h 03m");
    expect(formatDuration(-5)).toBe("0s");
  });
});
