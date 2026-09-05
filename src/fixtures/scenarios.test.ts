import { describe, expect, it } from "vitest";
import { splitSections } from "../features/note/sections";
import { makeBackend } from "./backend";
import { SCENARIOS } from "./scenarios";

/**
 * Fixtures rot silently.
 *
 * A gallery that renders a broken state looks exactly like a gallery
 * rendering a state that is meant to look like that, which makes it worse
 * than no gallery at all. These are the checks that catch the difference.
 */

/** Every command the app can send, from `ipc.ts`. */
const COMMANDS = [
  "list_input_devices",
  "list_output_devices",
  "model_status",
  "capture_status",
  "update_notes",
  "set_title",
  "list_notes",
  "notes_root",
  "recoverable_sessions",
  "recover_session",
  "discard_session",
  "reveal_notes_folder",
  "regenerate_notes",
  "can_regenerate",
];

describe("scenarios", () => {
  it("has unique ids", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every reading scenario a note that exists", () => {
    for (const s of SCENARIOS) {
      if (s.screen !== "note") continue;
      expect(s.notePath, `${s.id} has no notePath`).toBeTruthy();

      // Except the one whose whole point is a missing file.
      if (s.id === "note-missing") continue;
      expect(s.state.bodies?.[s.notePath ?? ""], `${s.id}: no body for ${s.notePath}`).toBeTruthy();
    }
  });

  it("describes what every scenario is for", () => {
    for (const s of SCENARIOS) {
      expect(s.note, `${s.id} has no note`).toBeTruthy();
      expect(s.name, `${s.id} has no name`).toBeTruthy();
    }
  });
});

describe("fake backend", () => {
  it("answers every command the app can send", async () => {
    const backend = makeBackend();
    for (const command of COMMANDS) {
      await expect(backend.invoke(command), `unhandled: ${command}`).resolves.not.toThrow();
    }
  });

  it("rejects an unknown command loudly", async () => {
    // Silence here would mean a new Rust command could be added and the
    // gallery would render a screen quietly missing whatever it returns.
    await expect(makeBackend().invoke("no_such_command")).rejects.toThrow(/unhandled command/);
  });

  it("serves the note bodies a scenario declares", async () => {
    const scenario = SCENARIOS.find((s) => s.id === "note-enhanced");
    const backend = makeBackend(scenario?.state);
    const body = await backend.invoke("read_note", { path: scenario?.notePath });
    expect(typeof body).toBe("string");
    expect(body as string).toContain("Pricing page rework");
  });

  it("fails to read the note the missing-file scenario points at", async () => {
    const scenario = SCENARIOS.find((s) => s.id === "note-missing");
    const backend = makeBackend(scenario?.state);
    await expect(backend.invoke("read_note", { path: scenario?.notePath })).rejects.toThrow();
  });
});

describe("fixture notes", () => {
  it("exercises both halves of the reading toggle", () => {
    const enhanced = SCENARIOS.find((s) => s.id === "note-enhanced");
    const body = enhanced?.state.bodies?.[enhanced.notePath ?? ""] ?? "";
    const s = splitSections(body);

    expect(s.hasEnhanced).toBe(true);
    expect(s.hasNotes).toBe(true);
    expect(s.transcript).toBeTruthy();
  });

  it("has a note with no generated half, so that state can be seen", () => {
    const raw = SCENARIOS.find((s) => s.id === "note-raw");
    const body = raw?.state.bodies?.[raw.notePath ?? ""] ?? "";
    expect(splitSections(body).hasEnhanced).toBe(false);
  });

  it("has a transcript long enough to test length", () => {
    const long = SCENARIOS.find((s) => s.id === "note-long");
    const body = long?.state.bodies?.[long.notePath ?? ""] ?? "";
    const turns = splitSections(body).transcript.split("\n\n").length;
    expect(turns).toBeGreaterThan(200);
  });
});
