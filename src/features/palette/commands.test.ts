import { describe, expect, it, vi } from "vitest";
import { CHANGELOG } from "../../changelog";
import type { AppearanceControl } from "../../design/appearance";
import { buildCommands, hiddenAction, hiddenReply, rankCommands, score } from "./commands";

function commands(recording = false) {
  const appearance = {
    setTheme: vi.fn(),
    setFamily: vi.fn(),
    setPreset: vi.fn(),
    reset: vi.fn(),
  } as unknown as AppearanceControl;
  const ctx = {
    navigate: vi.fn(),
    searchLibrary: vi.fn(),
    stopMeeting: vi.fn(),
    openGallery: vi.fn(),
    recording,
    appearance,
  };
  return { ctx, list: buildCommands(ctx) };
}

describe("score", () => {
  it("prefers a prefix, then a word, then anywhere, then letters in order", () => {
    const prefix = score("Appearance", "app") ?? -1;
    const word = score("Open the screen gallery", "gal") ?? -1;
    const inside = score("Settings", "tin") ?? -1;
    const scattered = score("Appearance", "apr") ?? -1;
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(scattered);
    expect(scattered).toBeGreaterThan(0);
  });

  it("refuses letters scattered across a long text", () => {
    expect(score("Reset this theme's adjustments", "rzq")).toBeNull();
    expect(score("Models", "xyz")).toBeNull();
  });
});

describe("commands", () => {
  it("offer Start when idle and Stop when recording, never both", () => {
    const idle = commands(false).list.map((c) => c.id);
    const live = commands(true).list.map((c) => c.id);
    expect(idle).toContain("meeting:start");
    expect(idle).not.toContain("meeting:stop");
    expect(live).toContain("meeting:stop");
    expect(live).not.toContain("meeting:start");
  });

  it("put the theme a name asks for first, and run it", () => {
    const { ctx, list } = commands();
    const [first] = rankCommands(list, "vault");
    expect(first?.id).toBe("theme:vault");
    first?.run();
    expect(ctx.appearance.setTheme).toHaveBeenCalledWith("vault");
  });

  it("find a place from a word it only answers to", () => {
    const [first] = rankCommands(commands().list, "microphone");
    expect(first?.id).toBe("go:settings");
  });

  it("show every command, in order, for an empty query", () => {
    const { list } = commands();
    expect(rankCommands(list, "  ")).toEqual(list);
  });
});

describe("hidden commands", () => {
  it("answer exact input, with or without the command prefix", () => {
    expect(hiddenReply("trace --who")).toEqual(["you."]);
    expect(hiddenReply(">  TRACE   --who ")).toEqual(["you."]);
  });

  it("never answer a partial, so they cannot be found by typing towards them", () => {
    expect(hiddenReply("trace --wh")).toBeNull();
    expect(hiddenReply("trace")).toBeNull();
  });

  it("are never offered as commands", () => {
    const ids = commands()
      .list.map((c) => `${c.label} ${c.keywords ?? ""}`)
      .join(" ");
    expect(ids).not.toMatch(/--why|--who|sudo|--changelog/);
  });

  it("print the latest changes for trace --changelog, and Enter opens the rest", () => {
    const reply = hiddenReply("trace --changelog") ?? [];
    expect(reply[0]).toBe(`${CHANGELOG[0]?.version} — ${CHANGELOG[0]?.title}`);
    expect(reply.at(-1)).toBe("enter: the whole log");
    expect(hiddenAction(" > trace  --changelog")).toBe("app:changelog");
    expect(hiddenAction("trace --who")).toBeNull();
  });
});
