import { describe, expect, it } from "vitest";
import type { CaptureStatus } from "../../lib/ipc";
import { type Trouble, troubles } from "./trouble";

function status(overrides: Partial<CaptureStatus> = {}): CaptureStatus {
  return {
    sessionId: "s",
    title: "t",
    elapsedMs: 0,
    levels: [],
    segmentCount: 0,
    droppedAudio: false,
    inFlight: 0,
    pendingSpeechMs: 0,
    transcribing: true,
    mic: null,
    speechModel: "m",
    memoryTight: false,
    diskMinutesLeft: null,
    lostStreams: [],
    journalFailing: false,
    pausedSinceMs: null,
    ...overrides,
  };
}

function worst(s: CaptureStatus): Trouble {
  const t = troubles(s)[0];
  if (!t) throw new Error("expected trouble");
  return t;
}

describe("troubles", () => {
  it("is empty for a healthy meeting", () => {
    expect(troubles(status())).toEqual([]);
  });

  it("says when a stream stopped, and why", () => {
    const t = worst(
      status({
        lostStreams: [{ source: "microphone", atMs: 41 * 60_000 + 7_000, reason: "disk full" }],
      }),
    );
    expect(t.tone).toBe("error");
    expect(t.message).toContain("41:07");
    expect(t.message).toContain("disk full");
    expect(t.short).toBe("mic stopped");
  });

  it("calls a stream lost in its first seconds one that never started", () => {
    const t = worst(
      status({ lostStreams: [{ source: "system", atMs: 300, reason: "no device" }] }),
    );
    expect(t.message).toMatch(/is not recording/);
    expect(t.message).not.toMatch(/stopped recording at/);
  });

  it("warns on a low disk, and turns it to an error near the end", () => {
    expect(worst(status({ diskMinutesLeft: 95 }))).toMatchObject({
      tone: "warn",
      short: "disk: 1h 35m left",
    });
    expect(worst(status({ diskMinutesLeft: 10 }))).toMatchObject({
      tone: "error",
      short: "disk: 10 min left",
    });
    expect(worst(status({ diskMinutesLeft: 0 })).short).toBe("disk full");
  });

  it("puts a lost stream before the disk, so the mini window shows the worse", () => {
    const found = troubles(
      status({
        diskMinutesLeft: 0,
        journalFailing: true,
        lostStreams: [{ source: "microphone", atMs: 60_000, reason: "disk full" }],
      }),
    );
    expect(found.map((t) => t.short)).toEqual([
      "mic stopped",
      "transcript not saving",
      "disk full",
    ]);
  });
});
