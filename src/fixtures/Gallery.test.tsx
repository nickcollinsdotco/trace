import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEMES } from "../design/theme";
import { Gallery } from "./Gallery";
import { SCENARIOS } from "./scenarios";

/**
 * Proof that the harness actually works.
 *
 * A gallery is only useful if it renders, and "it renders" is exactly the
 * kind of claim that is easy to assume and easy to get wrong — a fixture
 * missing one field shows an error state that looks like a designed error
 * state. So every scenario gets mounted here, and any console error fails the
 * test.
 */

afterEach(cleanup);

/**
 * Pick a scenario from the gallery's own list.
 *
 * Scoped to that list because the app's sidebar is always on screen now, and
 * "Meetings" or "About" is both a scenario and a place in the app.
 */
async function openScenario(user: ReturnType<typeof userEvent.setup>, name: string) {
  const list = screen.getByRole("navigation", { name: "Scenarios" });
  await user.click(within(list).getByRole("button", { name }));
}

/**
 * A meeting's title in the library list.
 *
 * By selector, because the signal panel above the list names meetings too —
 * "Longest: Pricing page rework" — and a bare text match finds both.
 */
const ROW = "[data-note-row] .trace-title";

/**
 * One model's card on the Models page, found by its name.
 *
 * By card rather than by "the nth Download button": the speech and summary
 * lists load independently, so how many buttons exist at any instant is a
 * race, and a test that counts them passes or fails on timing.
 */
async function modelCard(name: string): Promise<HTMLElement> {
  const title = await screen.findByText(name, { selector: ".trace-title" });
  const card = title.closest<HTMLElement>("[data-model-card]");
  if (!card) throw new Error(`no card around ${name}`);
  return card;
}

async function openEvery() {
  const user = userEvent.setup();
  render(<Gallery />);

  for (const scenario of SCENARIOS) {
    await openScenario(user, scenario.name);
    // The preview is keyed by scenario id, so this is a real remount.
    await waitFor(() => expect(screen.getByText(scenario.note)).toBeInTheDocument());
  }
}

/** The theme the preview's shell is wearing — not a swatch's or a sample's. */
function lookOf(container: HTMLElement): string | null {
  const themed = container.querySelector(".trace-shell")?.closest("[data-family]");
  return themed ? (themed.getAttribute("data-theme") ?? "carbon") : null;
}

describe("Gallery", () => {
  it("renders every scenario without logging an error", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });

    try {
      await openEvery();
    } finally {
      spy.mockRestore();
    }

    expect(errors, `console.error during render:\n${JSON.stringify(errors, null, 2)}`).toEqual([]);
  }, 30_000);

  it("shows the real library contents, not a placeholder", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");

    // Rendered by the actual LibraryScreen from fixture data.
    await waitFor(() =>
      expect(screen.getByText("Pricing page rework", { selector: ROW })).toBeInTheDocument(),
    );
  });

  it("themes the preview but never the harness chrome", async () => {
    const user = userEvent.setup();
    const { container } = render(<Gallery />);

    await user.click(screen.getByRole("button", { name: /industrial/ }));

    await waitFor(() => {
      expect(container.querySelector('[data-theme="industrial"]')).not.toBeNull();
    });
    // If the attribute landed on the root, the switcher itself would re-skin
    // and you could no longer tell the product from the tooling.
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  /*
   * These exist because "renders without a console error" passed happily
   * while every capture scenario was showing the setup panel. Rendering
   * *something* is not the same as rendering the state the scenario names.
   */
  it("lands directly in the live recording state", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Recording");

    // The live screen, not the setup panel — no Start required.
    await waitFor(() => expect(screen.getByText("Stop meeting")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(/CAPTURING/);
    expect(screen.getByText("Signal")).toBeInTheDocument();
    expect(screen.getByText("Mic")).toBeInTheDocument();

    // And with transcript history, as a meeting fourteen minutes in has.
    await waitFor(() =>
      expect(screen.getByText(/where did we land on the migration/)).toBeInTheDocument(),
    );
  });

  it("shows the processing indicator with real numbers behind it", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Transcribing");

    await waitFor(() => expect(screen.getByText("transcribing")).toBeInTheDocument());
    expect(screen.getByText(/3.4s buffered/)).toBeInTheDocument();
  });

  it("distinguishes listening from transcribing", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Listening");

    // inFlight is 0 here: speech is buffered but the model is not running.
    await waitFor(() => expect(screen.getByText("listening")).toBeInTheDocument());
    expect(screen.queryByText("transcribing")).toBeNull();
  });

  it("still offers the setup panel where that is the point", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Before recording");

    await waitFor(() => expect(screen.getByText("Start meeting")).toBeInTheDocument());
    expect(screen.queryByText("Stop meeting")).toBeNull();
  });

  it("opens a note with nothing typed on the summary side, not a dead end", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "No notes, no summary");

    // Ollama is closed in this scenario, so the button waits on it and the
    // notice says why — rather than a button that fails when pressed.
    const generate = await screen.findByRole("button", { name: "Generate summary" });
    await waitFor(() => expect(generate).toBeDisabled());
    expect(screen.getByText("Ollama isn’t running")).toBeInTheDocument();
    expect(screen.queryByText(/no notes were typed/)).toBeNull();
  });

  it("warns in the library when Ollama is closed, and only then", async () => {
    const user = userEvent.setup();
    render(<Gallery />);

    await openScenario(user, "Ollama closed");
    expect(await screen.findByText("Ollama isn’t running")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Ollama" })).toBeInTheDocument();

    await openScenario(user, "Ollama has no model");
    expect(await screen.findByText("ollama pull qwen3:8b")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Ollama" })).toBeNull();

    await openScenario(user, "Meetings");
    await screen.findByText("Pricing page rework", { selector: ROW });
    expect(screen.queryByText(/Notes offline/i)).toBeNull();
  });

  it("shows and hides meeting summaries in the library", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");

    const gist = /agreed it is doing too much at once/;
    expect(await screen.findByText(gist)).toBeInTheDocument();
    // A note without one says so, so the toggle never looks like it did nothing.
    expect(screen.getAllByText("— no summary").length).toBeGreaterThan(0);

    // The list/compact switch is the old Summaries toggle, and keeps its key.
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Compact view" }));

    expect(screen.getByRole("button", { name: "Compact view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText(gist)).toBeNull();
    expect(localStorage.getItem("trace.library.gists")).toBe("off");
  });

  it("shows both models and the build in the status bar", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");

    const bar = await screen.findByRole("contentinfo");
    await waitFor(() => expect(bar).toHaveTextContent("Parakeet TDT 0.6B v3 (int8)"));
    expect(bar).toHaveTextContent("qwen3:14b");
    expect(bar).toHaveTextContent("v0.1.0");
    expect(bar).toHaveTextContent("dev");
  });

  it("says in the status bar when summaries are offline", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Ollama closed");

    const bar = await screen.findByRole("contentinfo");
    await waitFor(() => expect(bar).toHaveTextContent("Ollama closed"));
  });

  it("marks the current page in the sidebar", async () => {
    const user = userEvent.setup();
    render(<Gallery />);

    await openScenario(user, "Meetings");
    const nav = await screen.findByRole("navigation", { name: "App" });
    expect(within(nav).getByRole("button", { name: /Meetings/ })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await openScenario(user, "Models");
    const again = await screen.findByRole("navigation", { name: "App" });
    expect(within(again).getByRole("button", { name: /Models/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(again).getByRole("button", { name: /Meetings/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("switches the speech model from the status bar, and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");

    const bar = await screen.findByRole("contentinfo");
    const trigger = await within(bar).findByRole("button", { name: /Parakeet TDT 0.6B v3/ });
    await user.click(trigger);
    const panel = screen.getByRole("dialog", { name: "Transcription model" });
    expect(within(panel).getByRole("button", { name: /Manage models/ })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Transcription model" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("switches the summary model from the status bar", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");

    const bar = await screen.findByRole("contentinfo");
    await user.click(await within(bar).findByRole("button", { name: /qwen3:14b/ }));
    const panel = screen.getByRole("dialog", { name: "Summary model" });
    await user.click(await within(panel).findByRole("button", { name: /qwen3:8b/ }));

    await waitFor(() => expect(bar).toHaveTextContent("qwen3:8b"));
    expect(screen.queryByRole("dialog", { name: "Summary model" })).toBeNull();
  });

  it("downloads a speech model with progress, then offers to use it", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Models");

    const card = await modelCard("Parakeet TDT 0.6B v2 (int8)");
    await user.click(within(card).getByRole("button", { name: "Download" }));
    expect(await within(card).findByRole("status", { name: "Downloading" })).toBeInTheDocument();
    // v3 is in use and v2 now installed, so v2 offers "Use".
    expect(
      await screen.findByRole("button", { name: "Use" }, { timeout: 5_000 }),
    ).toBeInTheDocument();
  });

  it("downloads a summary model through Ollama with progress", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Models, nothing in Ollama");

    const card = await modelCard("qwen3:14b");
    // No terminal command: the downloads on the page are the fix.
    expect(screen.queryByText(/ollama pull/)).toBeNull();
    await user.click(within(card).getByRole("button", { name: "Download" }));
    expect(await within(card).findByRole("status", { name: "Downloading" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("● In use")).toBeInTheDocument(), {
      timeout: 5_000,
    });
  });

  it("re-themes from the Appearance page", async () => {
    const user = userEvent.setup();
    const { container } = render(<Gallery />);
    await openScenario(user, "Appearance");

    const main = await screen.findByRole("main");
    const row = await within(main).findByRole("button", { name: /industrial/ });
    await user.click(row);

    await waitFor(() => expect(lookOf(container)).toBe("industrial"));
    expect(row).toHaveAttribute("aria-pressed", "true");
  });

  it("lays every theme out on the contact sheet", async () => {
    const user = userEvent.setup();
    const { container } = render(<Gallery />);
    await openScenario(user, "Contact sheet — every theme");
    await waitFor(() => expect(container.querySelectorAll("figure")).toHaveLength(THEMES.length));
  });

  it("names each theme's own choice first under Adjust, and does not offer it twice", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Appearance");
    const main = await screen.findByRole("main");

    const mono = await within(main).findByRole("group", { name: "Mono font" });
    expect(within(mono).getByRole("button", { name: "Theme · geist" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(mono).queryByRole("button", { name: "geist" })).toBeNull();
    expect(within(mono).getByRole("button", { name: "plex" })).toBeVisible();
  });

  it("previews a theme pointed at, and changes nothing until one is chosen", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const { container } = render(<Gallery />);
    await openScenario(user, "Appearance");
    const main = await screen.findByRole("main");

    await user.hover(await within(main).findByRole("button", { name: /teletext/ }));
    expect(await within(main).findByText(/click, or press Enter, to use it/)).toBeVisible();
    expect(lookOf(container)).toBe("carbon");

    await user.click(within(main).getByRole("button", { name: /teletext/ }));
    await waitFor(() => expect(lookOf(container)).toBe("teletext"));
    expect(within(main).getByText("· in use")).toBeVisible();
  });

  it("keeps a screen per family, and mixes it effect by effect", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const { container } = render(<Gallery />);
    await openScenario(user, "Appearance");
    const main = await screen.findByRole("main");

    // Retro starts on soft lines; Modern, where Carbon is, on clean glass.
    expect(container.querySelector("[data-fx-scanlines]")).toBeNull();
    await user.click(await within(main).findByRole("button", { name: /shell/ }));
    await waitFor(() =>
      expect(container.querySelector('[data-fx-scanlines="over"]')).not.toBeNull(),
    );
    await user.click(within(main).getByRole("button", { name: "crt" }));
    await waitFor(() =>
      expect(container.querySelector('[data-screen-preset="crt"][data-fx-roll]')).not.toBeNull(),
    );

    await user.click(within(main).getByRole("button", { name: /graphite/ }));
    await waitFor(() => expect(container.querySelector("[data-fx-scanlines]")).toBeNull());
    await user.click(within(main).getByRole("button", { name: /shell/ }));
    await waitFor(() =>
      expect(container.querySelector('[data-screen-preset="crt"]')).not.toBeNull(),
    );

    // One effect moved by hand: the mix is custom, and grain goes behind.
    const grain = within(main).getByRole("slider", { name: "Grain" });
    fireEvent.change(grain, { target: { value: "60" } });
    const placement = within(main).getByRole("group", { name: "Grain placement" });
    await user.click(within(placement).getByRole("button", { name: "behind" }));
    await waitFor(() => expect(container.querySelector('[data-fx-grain="behind"]')).not.toBeNull());
    expect(container.querySelector("[data-screen-preset]")).toBeNull();
    expect(within(main).getByText("custom")).toBeInTheDocument();

    // The effects are layers on the page, never on the sidebar.
    const nav = screen.getByRole("navigation", { name: "App" });
    expect(nav.closest(".trace-canvas")).toBeNull();
    expect(container.querySelector(".trace-canvas .trace-fx-grain")).not.toBeNull();
  });

  it("tests the microphone only when asked, and stops when asked", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Before recording");

    const test = await screen.findByRole("button", { name: "Test mic" });
    expect(screen.queryByRole("img", { name: /Microphone level/ })).toBeNull();

    await user.click(test);
    expect(await screen.findByRole("img", { name: "Microphone level, live" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop test" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: /Microphone level/ })).toBeNull());
  });

  it("copies a diagnostics report that says what is on the GPU", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    // The model is only in memory while TRACE needs it, so the report is
    // opened mid-job: that is when "why is this using memory" gets asked.
    await openScenario(user, "About, notes being written");
    // Where someone checking their version looks next for how to update.
    expect(await screen.findByText("pnpm update-app")).toBeInTheDocument();

    // Each appears twice: in its section, and in the collapsed plain-text copy.
    expect((await screen.findAllByText(/100% on GPU/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/summary written in 68s/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Copy report" }));
    const copied = await navigator.clipboard.readText();
    expect(copied).toContain("TRACE diagnostics");
    expect(copied).toContain("ready, using qwen3:14b");
    expect(copied).toContain("summarising with qwen3:14b");
    expect(screen.getByText(/copied/)).toBeInTheDocument();
  });

  it("disables regeneration when the journal is gone", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Cannot be regenerated");

    const regenerate = await screen.findByRole("button", { name: "↻" });
    await waitFor(() => expect(regenerate).toBeDisabled());
    expect(regenerate).toHaveAttribute("title", expect.stringContaining("no longer on disk"));
  });

  it("still offers regeneration when the journal survives", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Enhanced note");

    const regenerate = await screen.findByRole("button", { name: "↻" });
    await waitFor(() => expect(regenerate).toBeEnabled());
  });

  it("keeps a note busy while its notes are being written, from a fresh mount", async () => {
    // The screen mounts with the job already running, which is exactly the
    // case that used to re-enable ↻: leaving the note and coming back.
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Regenerating");

    const regenerate = await screen.findByRole("button", { name: "↻" });
    await waitFor(() => expect(regenerate).toBeDisabled());
    expect(regenerate).toHaveAttribute("title", "Notes for this meeting are being written");
    expect(screen.getByText(/these are the previous notes/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("part 2 of 3");

    const bar = await screen.findByRole("contentinfo");
    expect(bar).toHaveTextContent("writing notes, part 2 of 3");
    expect(within(bar).getByRole("img", { name: "1 of 3 parts written" })).toBeInTheDocument();
  });

  it("opens the status bar entry into each job's steps", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Two meetings queued");

    const bar = await screen.findByRole("contentinfo");
    const trigger = await within(bar).findByRole("button", { name: /writing notes/ });
    expect(trigger).toHaveTextContent("+1 queued");

    await user.click(trigger);
    const panel = screen.getByRole("dialog", { name: "Background work" });
    expect(within(panel).getByText("Pricing page rework")).toBeInTheDocument();
    expect(within(panel).getByText("Vendor call — Northwind")).toBeInTheDocument();
    expect(
      within(panel).getByText(/queued — one meeting's notes are written at a time/),
    ).toBeInTheDocument();
    expect(within(panel).getAllByRole("button", { name: "Open note" })).toHaveLength(2);
  });

  it("shows where the summary will be while a new note's is written", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Waiting its turn");

    expect(
      await screen.findByText("The summary and action items are being written."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no summary for this meeting yet/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("waiting for another meeting's notes");
  });

  it("runs a regenerate through to the end", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Enhanced note");

    const regenerate = await screen.findByRole("button", { name: "↻" });
    await waitFor(() => expect(regenerate).toBeEnabled());
    await user.click(regenerate);

    expect(regenerate).toBeDisabled();
    const bar = await screen.findByRole("contentinfo");
    await waitFor(() => expect(bar).toHaveTextContent("writing notes, part 1 of 3"));
    await waitFor(() => expect(screen.getByText(/notes generated/)).toBeInTheDocument(), {
      timeout: 8_000,
    });
    expect(regenerate).toBeEnabled();
    expect(bar).not.toHaveTextContent("writing notes");
  }, 15_000);

  it("writes notes from the live transcript when the full-quality pass fails", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Full-quality pass failed");

    const bar = await screen.findByRole("contentinfo");
    await waitFor(() => expect(bar).toHaveTextContent("writing notes from the live transcript"), {
      timeout: 4_000,
    });

    // It carries on to the end rather than stopping at the failure.
    const done = await screen.findByRole(
      "button",
      { name: /notes generated from the live transcript/ },
      { timeout: 8_000 },
    );
    expect(
      await screen.findByText("Drop-off concentrates at the comparison table, not the prices"),
    ).toBeInTheDocument();

    // Already on this note, so no toast repeating it.
    expect(screen.queryByText(/notes ready/)).toBeNull();

    await user.click(done);
    expect(screen.getByText(/└ the transcription model did not load/)).toBeInTheDocument();
    expect(screen.getByText("FAIL")).toBeInTheDocument();
  }, 15_000);

  it("opens on the generated half while notes are written, but never overrides a choice", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Notes being written");

    const enhanced = await screen.findByRole("button", { name: "Enhanced" });
    await waitFor(() => expect(enhanced).toHaveAttribute("aria-pressed", "true"));

    const mine = screen.getByRole("button", { name: "My notes" });
    await user.click(mine);
    // Later updates to the job must not pull the reader back.
    const bar = await screen.findByRole("contentinfo");
    await waitFor(() => expect(bar).toHaveTextContent("part 1 of 3"), { timeout: 4_000 });
    expect(mine).toHaveAttribute("aria-pressed", "true");
  }, 10_000);

  it("says what the summary model is holding in memory while notes are written", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Two meetings queued");

    const bar = await screen.findByRole("contentinfo");
    await user.click(await within(bar).findByRole("button", { name: /qwen3:14b/ }));
    const panel = screen.getByRole("dialog", { name: "Summary model" });
    expect(await within(panel).findByText(/in memory · 10\.5 GiB/)).toBeInTheDocument();
    expect(within(panel).getByText(/until \d/)).toBeInTheDocument();
  });

  it("shows nothing in memory once no meeting or notes need the model", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");

    const bar = await screen.findByRole("contentinfo");
    await user.click(await within(bar).findByRole("button", { name: /qwen3:14b/ }));
    const panel = screen.getByRole("dialog", { name: "Summary model" });
    // The installed list and what is in memory arrive in one answer, so the
    // list being there means the absence below is real, not still loading.
    await within(panel).findByRole("button", { name: /qwen3:14b/ });
    expect(within(panel).queryByText(/in memory/)).not.toBeInTheDocument();
  });

  it("shows the first-run report with measured facts, not placeholders", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Machine report");

    await waitFor(() => expect(screen.getByText("NICK-DESKTOP")).toBeInTheDocument());
    expect(screen.getByText(/Ryzen 7 7800X3D/)).toBeInTheDocument();
    expect(screen.getByText("8 core / 16 thread")).toBeInTheDocument();
    // Binary units. Above 100 the formatter drops decimals, so 456 MiB.
    expect(screen.getByText("456 MiB")).toBeInTheDocument();
    expect(screen.getByText("31.1 GiB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Install/ })).toBeInTheDocument();
  });

  it("never claims GPU acceleration it does not have", async () => {
    // The build has no ort-directml feature. A setup screen whose whole job
    // is telling the truth about this machine is the worst place to overclaim.
    const user = userEvent.setup();
    const { container } = render(<Gallery />);
    await openScenario(user, "Machine report");

    await waitFor(() => expect(screen.getByText("NICK-DESKTOP")).toBeInTheDocument());
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/DirectML/i);
    expect(text).toMatch(/ONNX Runtime/);
  });

  it("deletes audio by default, and says what keeping it costs", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Before recording");

    const retention = await screen.findByRole("combobox", { name: "Keep audio" });
    expect(retention).toHaveValue("delete");
    // "Keep audio" without the figure is a choice made blind.
    expect(screen.getByText(/690 MB per hour/)).toBeInTheDocument();
  });

  it("reflects what the backend stored, not what the click assumed", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Before recording");

    const retention = await screen.findByRole("combobox", { name: "Keep audio" });
    await user.selectOptions(retention, "keep_latest");
    await waitFor(() => expect(retention).toHaveValue("keep_latest"));
    expect(screen.getByRole("spinbutton", { name: /Number of meetings/ })).toHaveValue(5);
  });

  it("offers rename and delete on a meeting", async () => {
    // Neither was reachable at all before: a library full of "ggg" and "dad2"
    // with no way to tidy it.
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");

    await waitFor(() =>
      expect(screen.getByText("Pricing page rework", { selector: ROW })).toBeInTheDocument(),
    );
    // In each row's menu, rather than two buttons reserved in every row.
    await user.click(screen.getAllByRole("button", { name: "Meeting actions" })[1] as HTMLElement);
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("removes a meeting from the list when deleted", async () => {
    const user = userEvent.setup();
    const native = vi.spyOn(window, "confirm");
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() =>
      expect(screen.getByText("Pricing page rework", { selector: ROW })).toBeInTheDocument(),
    );

    // The row order matches the fixture list; the second is "Pricing page rework".
    await user.click(screen.getAllByRole("button", { name: "Meeting actions" })[1] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    // Asked in the app's own dialog, never the browser's "tauri.localhost
    // says" box, and it names the consequence.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Delete “Pricing page rework”?");
    expect(native).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Delete meeting" }));

    await waitFor(() =>
      expect(screen.queryByText("Pricing page rework", { selector: ROW })).toBeNull(),
    );
    native.mockRestore();
  });

  it("does not delete when the confirmation is declined", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() =>
      expect(screen.getByText("Pricing page rework", { selector: ROW })).toBeInTheDocument(),
    );

    await user.click(screen.getAllByRole("button", { name: "Meeting actions" })[1] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    // Focus starts on the safe answer, so Enter cannot delete by accident.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // Still there. A destructive action that ignores "no" is worse than none.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Pricing page rework", { selector: ROW })).toBeInTheDocument();
  });

  it("renames a meeting in place, and Escape leaves it as it was", async () => {
    const prompt = vi.spyOn(window, "prompt");
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await screen.findByText("Pricing page rework", { selector: ROW });

    await user.click(screen.getAllByRole("button", { name: "Meeting actions" })[1] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const field = await screen.findByRole("textbox", { name: "Rename Pricing page rework" });
    expect(field).toHaveValue("Pricing page rework");
    await user.clear(field);
    await user.type(field, "Pricing, round two{Enter}");

    expect(await screen.findByText("Pricing, round two", { selector: ROW })).toBeInTheDocument();
    // The browser's "tauri.localhost says" box is gone for good.
    expect(prompt).not.toHaveBeenCalled();

    // F2 on a row, the Windows convention, and Escape puts it back.
    const open = screen.getByText("Catch-up with Dev", { selector: ROW }).closest("button");
    open?.focus();
    await user.keyboard("{F2}");
    const again = await screen.findByRole("textbox", { name: "Rename Catch-up with Dev" });
    await user.type(again, " and more{Escape}");
    expect(await screen.findByText("Catch-up with Dev", { selector: ROW })).toBeInTheDocument();
    prompt.mockRestore();
  });

  it("suggests the library's own tags while a tag is typed", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Enhanced note");

    await user.click(await screen.findByRole("button", { name: "+ Tag" }));
    // Nothing typed: the tags in use that this note has not got yet.
    const list = await screen.findByRole("listbox", { name: "Tags already in use" });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["internal1", "planning1"]);

    await user.type(screen.getByRole("combobox", { name: "New tag" }), "pl");
    await user.keyboard("{Tab}");
    // Completed from "pl" and added: the tag's own button is named by its text.
    expect(await screen.findByRole("button", { name: "planning" })).toBeInTheDocument();
  });

  it("autofills people and filters in the search line", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await screen.findByText("Pricing page rework", { selector: ROW });

    const search = screen.getByRole("combobox", { name: "Search meetings and transcripts" });
    await user.click(search);
    await user.type(search, "sa");
    const list = await screen.findByRole("listbox", { name: "Suggestions" });
    expect(within(list).getByRole("option", { name: /with:Sarah Chen/ })).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(search).toHaveValue("with:sarah-chen ");
    // Only the meetings she was in.
    await waitFor(() =>
      expect(screen.queryByText("Catch-up with Dev", { selector: ROW })).toBeNull(),
    );
    expect(screen.getByText("Pricing page rework", { selector: ROW })).toBeInTheDocument();
    expect(screen.getByText("Quarterly planning", { selector: ROW })).toBeInTheDocument();
  });

  it("hides the sidebar by hand and keeps the recording in view", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Recording");
    await screen.findByRole("navigation", { name: "App" });

    await user.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(screen.queryByRole("navigation", { name: "App" })).toBeNull();
    // The strip that replaces it still says a meeting is running.
    // Named with its timer, which also tells it from the scenario called
    // "Recording" in the gallery's own list.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Recording\s*\d/ })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(await screen.findByRole("navigation", { name: "App" })).toBeInTheDocument();
  });

  it("offers discarding a recording in progress", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Recording");

    await waitFor(() => expect(screen.getByText("Stop meeting")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("gives a note a real heading outline", async () => {
    // A note is a document. Its sections were styled spans inside a
    // <header>, so a screen reader got no outline of it and no way to jump
    // between parts.
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Enhanced note");

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /Pricing page rework/ })).toBeVisible(),
    );
    expect(screen.getByRole("heading", { level: 2, name: /Summary/ })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: /Decisions/ })).toBeVisible();
  });

  it("truncates a long meeting title rather than overflowing the row", async () => {
    // `truncate` on an inline <span> does nothing — overflow and
    // text-overflow do not apply to non-replaced inline elements.
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");

    // The title span is made `block` for exactly that reason, and its button
    // must be allowed to shrink or there is nothing to truncate against.
    const title = await screen.findByText("Pricing page rework", { selector: ROW });
    expect(title.classList.contains("truncate")).toBe(true);
    expect(title.classList.contains("block")).toBe(true);
    expect(title.closest("button")?.classList.contains("min-w-0")).toBe(true);
  });

  it("searches transcripts, not just titles, and says why each matched", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() =>
      expect(screen.getByText("Pricing page rework", { selector: ROW })).toBeInTheDocument(),
    );

    // "comparison" appears only in a transcript line, never in a title.
    await user.type(
      screen.getByRole("combobox", { name: "Search meetings and transcripts" }),
      "comparison",
    );

    await waitFor(() => expect(screen.getByText(/1 result/)).toBeInTheDocument());
    expect(screen.getByText(/comparison table/i)).toBeInTheDocument();
  });

  it("requires every term to appear", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() =>
      expect(screen.getByText("Pricing page rework", { selector: ROW })).toBeInTheDocument(),
    );

    await user.type(
      screen.getByRole("combobox", { name: "Search meetings and transcripts" }),
      "pricing elephant",
    );

    await waitFor(() => expect(screen.getByText(/nothing matches/)).toBeInTheDocument());
  });

  it("restores the grouped list when the query is cleared", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() =>
      expect(screen.getByText("Pricing page rework", { selector: ROW })).toBeInTheDocument(),
    );

    const box = screen.getByRole("combobox", { name: "Search meetings and transcripts" });
    await user.type(box, "comparison");
    await waitFor(() => expect(screen.getByText(/1 result/)).toBeInTheDocument());

    await user.clear(box);
    // Back to the library, not an empty result set.
    await waitFor(() => expect(screen.queryByText(/result/)).toBeNull());
    expect(screen.getByText("Monday standup", { selector: ROW })).toBeInTheDocument();
  });

  it("shows a note's tags and lets one be added", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Enhanced note");

    await waitFor(() => expect(screen.getByRole("button", { name: "pricing" })).toBeVisible());
    await user.click(screen.getByRole("button", { name: "+ Tag" }));
    await user.type(screen.getByRole("combobox", { name: "New tag" }), "Design Review{Enter}");

    // Normalised on the way in — the UI shows what the store would write.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "design-review" })).toBeVisible(),
    );
  });

  it("removes a tag", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Enhanced note");

    await waitFor(() => expect(screen.getByRole("button", { name: "client" })).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Remove tag client" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "client" })).toBeNull());
    // The others are untouched.
    expect(screen.getByRole("button", { name: "pricing" })).toBeVisible();
  });

  it("shows each meeting's tags in the library and filters by one", async () => {
    // Every row used to read "general" — the meeting type, which nothing sets
    // — so tagging looked broken from the library.
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() =>
      expect(screen.getByText("Monday standup", { selector: ROW })).toBeInTheDocument(),
    );

    expect(screen.queryByText("general")).toBeNull();
    const filters = screen.getByRole("group", { name: "Filter by tag" });
    // Pills carry their counts, as the reference's categories do.
    await user.click(within(filters).getByRole("button", { name: "internal 1" }));

    await waitFor(() =>
      expect(screen.queryByText("Pricing page rework", { selector: ROW })).toBeNull(),
    );
    expect(screen.getByText("Monday standup", { selector: ROW })).toBeInTheDocument();

    // And the search line says so, since the controls only ever edit it.
    expect(screen.getByRole("combobox", { name: "Search meetings and transcripts" })).toHaveValue(
      "tag:internal",
    );
    await user.click(within(filters).getByRole("button", { name: "All 6" }));
    await waitFor(() =>
      expect(screen.getByText("Pricing page rework", { selector: ROW })).toBeInTheDocument(),
    );
  });

  it("orders the library oldest first on request", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() =>
      expect(screen.getByText("Monday standup", { selector: ROW })).toBeInTheDocument(),
    );

    const titles = () => [...document.querySelectorAll(ROW)].map((e) => e.textContent);
    expect(titles()[0]).toBe("Catch-up with Dev");

    // One click reverses: the face of the sort button turns the order round.
    await user.click(screen.getByRole("button", { name: /Newest first/ }));
    const line = screen.getByRole("combobox", { name: "Search meetings and transcripts" });
    expect(line).toHaveValue("sort:oldest");
    await waitFor(() => expect(titles()[0]).toBe("Acme discovery call"));
    expect(titles().at(-1)).toBe("Catch-up with Dev");

    // The arrow changes what is ordered and keeps the direction.
    await user.click(screen.getByRole("button", { name: "Sort by" }));
    await user.click(screen.getByRole("button", { name: /Length/ }));
    expect(line).toHaveValue("sort:shortest");
    await user.click(screen.getByRole("button", { name: /Shortest first/ }));
    expect(line).toHaveValue("sort:longest");
  });

  it("lists every tag under Filters", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await screen.findByText("Monday standup", { selector: ROW });

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    const panel = screen.getByRole("dialog", { name: "Filters" });
    await user.click(within(panel).getByRole("button", { name: "internal 1" }));
    expect(screen.getByRole("combobox", { name: "Search meetings and transcripts" })).toHaveValue(
      "tag:internal",
    );
    // The tag is a tag, not a filter: the badge counts length, summary, type.
    expect(screen.getByRole("button", { name: /Filters/ })).toHaveAccessibleName("Filters");
  });

  it("frames each section of a note so it can be closed, with the transcript closed", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Enhanced note");

    const summary = await screen.findByRole("button", { name: "Summary" });
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(summary.closest(".trace-section")).not.toBeNull();
    expect(screen.getByText(/most visitors leave at the comparison table/)).toBeVisible();

    await user.click(summary);
    expect(screen.queryByText(/most visitors leave at the comparison table/)).toBeNull();

    const transcript = screen.getByRole("button", { name: "Transcript" });
    expect(transcript).toHaveAttribute("aria-expanded", "false");
    await user.click(transcript);
    expect(screen.getByText(/I pulled the numbers this morning/)).toBeVisible();
  });

  it("moves the note's title into the top bar once it scrolls away", async () => {
    // jsdom has no layout, so the observer is played by hand: the title is
    // reported as having left through the top of the scroller.
    const callbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          callbacks.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Enhanced note");

    const bar = await screen.findByRole("navigation", { name: "Breadcrumb" });
    await screen.findByRole("heading", { level: 1, name: "Pricing page rework" });
    expect(within(bar).queryByText("Pricing page rework")).toBeNull();

    const gone = {
      isIntersecting: false,
      boundingClientRect: { top: -40 },
      rootBounds: { top: 0 },
    } as unknown as IntersectionObserverEntry;
    for (const cb of callbacks) cb([gone], {} as IntersectionObserver);

    await waitFor(() => expect(within(bar).getByText("Pricing page rework")).toBeVisible());
    expect(within(bar).getByText("Meetings")).toBeVisible();
    vi.unstubAllGlobals();
  });

  it("filters by length and summary from the Filters menu, writing it into the search line", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await screen.findByText("Monday standup", { selector: ROW });

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.click(screen.getByRole("button", { name: /Under 15 min/ }));

    expect(screen.getByRole("combobox", { name: "Search meetings and transcripts" })).toHaveValue(
      "len:<15m",
    );
    await waitFor(() =>
      expect(screen.queryByText("Pricing page rework", { selector: ROW })).toBeNull(),
    );
    expect(screen.getByText("Monday standup", { selector: ROW })).toBeInTheDocument();
    expect(screen.getByText(/1 of 6 meetings/)).toBeInTheDocument();
  });

  it("shows the last meeting's loudness in the signal panel", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");

    expect(
      await screen.findByRole("img", { name: "Loudness across Catch-up with Dev" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Meetings per day this week" })).toBeInTheDocument();
  });

  it("names THEM in the transcript once one name is given", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Context and a name given");

    await user.click(await screen.findByRole("button", { name: "Transcript" }));
    // The transcript line itself, found by what was said, not any "Dev" on
    // screen — the "With" summary above says Dev too.
    const said = await screen.findByText("quiet, which was the point");
    const line = said.closest("p");
    expect(line).not.toBeNull();
    expect(within(line as HTMLElement).getByTitle("Dev")).toHaveTextContent("Dev");
    expect(within(line as HTMLElement).queryByText("them")).toBeNull();
    // The user's own line is untouched.
    const mine = screen.getByText("how was the weekend").closest("p") as HTMLElement;
    expect(within(mine).getByText("you")).toBeInTheDocument();
    expect(screen.getByText(/joined the design team last month/)).toBeVisible();
  });

  it("saves context and names, then regenerates with them", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Enhanced note");

    await user.click(await screen.findByRole("button", { name: "+ Context & names" }));
    await user.type(screen.getByRole("textbox", { name: "Who was on the other end?" }), "Sarah");
    await user.type(
      screen.getByRole("textbox", { name: "What should the summary know?" }),
      "A design review with the growth team.",
    );
    await user.click(screen.getByRole("button", { name: "Save and regenerate" }));

    await waitFor(() =>
      expect(screen.getByText("A design review with the growth team.")).toBeVisible(),
    );
    expect(screen.getByText("Sarah")).toBeVisible();
    // The regeneration it asked for is running.
    await waitFor(() =>
      expect(screen.getAllByText(/rewriting — these are the previous notes/).length).toBe(1),
    );
  });

  it("narrows to tagged notes with tag:", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() =>
      expect(screen.getByText("Monday standup", { selector: ROW })).toBeInTheDocument(),
    );

    await user.type(
      screen.getByRole("combobox", { name: "Search meetings and transcripts" }),
      "tag:client",
    );

    // Filters alone are answered from the listing, with no search at all.
    await waitFor(() => expect(screen.getByText(/1 of 6 meetings/)).toBeInTheDocument());
    expect(screen.getByText("Pricing page rework", { selector: ROW })).toBeInTheDocument();
    expect(screen.queryByText("Monday standup", { selector: ROW })).toBeNull();
  });

  it("clears the fake backend when it unmounts", async () => {
    const { hasBackend } = await import("../lib/ipc");
    const { unmount } = render(<Gallery />);
    expect(hasBackend()).toBe(true);

    unmount();
    expect(hasBackend()).toBe(false);
  });

  it("opens the palette with every command, the best one ready for Enter", async () => {
    const user = userEvent.setup();
    const { container } = render(<Gallery />);
    await openScenario(user, "Command palette");

    const palette = await screen.findByRole("dialog", { name: "Command palette" });
    const input = within(palette).getByRole("combobox", { name: "Command" });
    expect(within(palette).getByRole("option", { name: "Start a meeting" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Typing narrows it, and Enter runs the top match: here, a theme.
    await user.type(input, "vault");
    expect(within(palette).getAllByRole("option")[0]).toHaveTextContent("vault");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(container.querySelector('[data-theme="vault"]')).not.toBeNull());
  });

  it("finds meetings in the palette, after the commands", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Palette, finding a meeting");

    const palette = await screen.findByRole("dialog", { name: "Command palette" });
    expect(
      await within(palette).findByRole("option", { name: /Pricing page rework/ }),
    ).toBeInTheDocument();
    expect(within(palette).getByText("Meetings")).toBeInTheDocument();
    // And always the way into the library's fuller search.
    expect(
      within(palette).getByRole("option", { name: "Search meetings for “pric”" }),
    ).toBeInTheDocument();
  });

  it("answers a hidden command instead of listing anything", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Palette, a hidden command");

    const palette = await screen.findByRole("dialog", { name: "Command palette" });
    expect(within(palette).getByText("because someone will ask")).toBeInTheDocument();
    expect(within(palette).queryByRole("listbox")).toBeNull();
  });

  it("lets the narrator speak in Fun mode, and only then", async () => {
    const user = userEvent.setup();
    render(<Gallery />);

    await openScenario(user, "Meetings");
    const bar = await screen.findByRole("contentinfo");
    expect(within(bar).queryByRole("status")).toBeNull();

    await openScenario(user, "Fun mode, the narrator");
    const funBar = await screen.findByRole("contentinfo");
    expect(
      await within(funBar).findByRole("status", { name: /the machine will now speak/ }),
    ).toBeInTheDocument();
  });

  it("boots in Fun mode, line by line, to READY", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Fun mode, booting");

    const boot = await screen.findByRole("status", { name: "TRACE starting" });
    expect(boot).toHaveTextContent("TRACE / INITIALIZING");
    await waitFor(() => expect(boot).toHaveTextContent("READY."), { timeout: 3_000 });
  });

  it("shows the found file", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Found file");

    const file = await screen.findByRole("dialog", { name: "Found file" });
    expect(file).toHaveTextContent("So we kept a trace.");
  });

  it("shows the scope above the notes, and opens it full screen with a line for notes", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Recording");
    expect(await screen.findByRole("img", { name: /Live scope, wave/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /scope view/ }));
    const view = await screen.findByRole("dialog", { name: "Scope view" });
    const prompt = within(view).getByRole("textbox", { name: "Add a line to the notes" });
    expect(prompt).toHaveFocus();

    // A line typed here lands in the notes, and Escape goes back to them.
    await user.type(prompt, "ship it friday{Enter}");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Scope view" })).toBeNull());
    expect(screen.getByPlaceholderText("type only what matters…")).toHaveValue("ship it friday");
  });

  it("shows the mini window recording, idle and saved", async () => {
    const user = userEvent.setup();
    render(<Gallery />);

    await openScenario(user, "Mini window, recording");
    expect(await screen.findByRole("button", { name: /hold to stop/ })).toBeInTheDocument();
    expect(await screen.findByText(/^31:/)).toBeInTheDocument();
    // Closing it is offered, and says the meeting carries on.
    expect(screen.getByRole("button", { name: "Close the mini window" })).toHaveAttribute(
      "title",
      expect.stringMatching(/keeps recording/),
    );

    await openScenario(user, "Mini window, idle");
    expect(await screen.findByRole("textbox", { name: "Meeting name" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start meeting/ })).toBeInTheDocument();

    await openScenario(user, "Mini window, saved");
    expect(await screen.findByText("✓ saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "open" })).toBeInTheDocument();
  });

  it("offers the mini window from the sidebar", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    // In the app's sidebar, not the gallery's list, which names scenarios
    // after it too.
    const sidebar = await screen.findByRole("complementary", { name: "Sidebar" });
    expect(within(sidebar).getByRole("button", { name: /Mini window/ })).toBeInTheDocument();
  });

  it("keeps the mini window's minor switches in its options menu", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Mini window, options");

    const menu = await screen.findByRole("menu", { name: "Mini window options" });
    const wave = within(menu).getByRole("menuitemcheckbox", { name: "Waveform" });
    expect(wave).toHaveAttribute("aria-checked", "true");
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: "Hidden from screen shares" }),
    ).toHaveAttribute("aria-checked", "true");

    // The extended view names what the meeting listens and transcribes with.
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: /Details/ }));
    expect(await screen.findByText("Microphone (Razer Seiren V3 Mini)")).toBeInTheDocument();
    expect(
      screen.getByText("Parakeet TDT 0.6B v3 (int8)", { selector: "span" }),
    ).toBeInTheDocument();

    await user.click(wave);
    expect(wave).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("img", { name: "Both voices, live" })).toBeNull();
  });

  it("offers, once and inline, to open the mini window by itself", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Mini window, the offer");

    const question = await screen.findByText("Open this whenever you switch away from TRACE?");
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(question).not.toBeInTheDocument();
    // The bar carries on underneath, unchanged.
    expect(screen.getByRole("button", { name: /hold to stop/ })).toBeInTheDocument();
  });

  it("lets Settings choose when the mini window opens, off until asked", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Settings");

    const group = await screen.findByRole("radiogroup", { name: "When the mini window opens" });
    expect(within(group).getByRole("radio", { name: /Only when I open it/ })).toBeChecked();
    await user.click(within(group).getByRole("radio", { name: /When I switch away/ }));
    await waitFor(() =>
      expect(within(group).getByRole("radio", { name: /When I switch away/ })).toBeChecked(),
    );
  });

  it("marks what changed lately, and keeps the marks once everything is read", async () => {
    localStorage.removeItem("trace.gallery.seen");
    const user = userEvent.setup();
    render(<Gallery />);

    expect(await screen.findByText(/unread/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "mark all read" }));
    expect(await screen.findByText(/all read/)).toBeVisible();
    // Read, the badges stay: the list still says what changed, and when.
    const nav = screen.getByRole("navigation", { name: "Scenarios" });
    const marked = within(nav)
      .getAllByRole("button")
      .filter((b) => /^\d+\.\d+\.\d+: /.test(b.title));
    expect(marked.length).toBeGreaterThan(0);
  });

  it("records the mini window's shortcut by having it pressed, and refuses Shift alone", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Settings");

    const field = await screen.findByRole("button", { name: /Shortcut: Ctrl\+Shift\+Alt\+M/ });
    await user.click(field);
    await user.keyboard("{Shift>}M{/Shift}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Hold Ctrl, Alt or the Windows key/);

    await user.keyboard("{Control>}{Alt>}J{/Alt}{/Control}");
    expect(await screen.findByRole("button", { name: /Shortcut: Ctrl\+Alt\+J/ })).toBeVisible();
  });
});
