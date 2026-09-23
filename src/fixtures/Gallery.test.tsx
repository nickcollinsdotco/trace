import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    await waitFor(() => expect(screen.getByText("Pricing page rework")).toBeInTheDocument());
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
    await screen.findByText("Pricing page rework");
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

    const toggle = screen.getByRole("button", { name: "Summaries" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "false");
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
    const card = await within(main).findByRole("button", { name: /industrial/ });
    await user.click(card);

    await waitFor(() => {
      expect(container.querySelector('[data-theme="industrial"]')).not.toBeNull();
    });
    expect(card).toHaveAttribute("aria-pressed", "true");
  });

  it("copies a diagnostics report that says what is on the GPU", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "About");
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

  it("says what the summary model is holding in memory", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");

    const bar = await screen.findByRole("contentinfo");
    await user.click(await within(bar).findByRole("button", { name: /qwen3:14b/ }));
    const panel = screen.getByRole("dialog", { name: "Summary model" });
    expect(await within(panel).findByText(/in memory · 10\.5 GiB/)).toBeInTheDocument();
    expect(within(panel).getByText(/until \d/)).toBeInTheDocument();
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

    await waitFor(() => expect(screen.getByText("Pricing page rework")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Rename" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Delete" }).length).toBeGreaterThan(0);
  });

  it("removes a meeting from the list when deleted", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() => expect(screen.getByText("Pricing page rework")).toBeInTheDocument());

    // The row order matches the fixture list; the second is "Pricing page rework".
    await user.click(screen.getAllByRole("button", { name: "Delete" })[1] as HTMLElement);

    await waitFor(() => expect(screen.queryByText("Pricing page rework")).toBeNull());
    confirm.mockRestore();
  });

  it("does not delete when the confirmation is declined", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() => expect(screen.getByText("Pricing page rework")).toBeInTheDocument());

    await user.click(screen.getAllByRole("button", { name: "Delete" })[1] as HTMLElement);

    // Still there. A destructive action that ignores "no" is worse than none.
    expect(screen.getByText("Pricing page rework")).toBeInTheDocument();
    confirm.mockRestore();
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
    const title = await screen.findByText("Pricing page rework");
    expect(title.classList.contains("truncate")).toBe(true);
    expect(title.classList.contains("block")).toBe(true);
    expect(title.closest("button")?.classList.contains("min-w-0")).toBe(true);
  });

  it("searches transcripts, not just titles, and says why each matched", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() => expect(screen.getByText("Pricing page rework")).toBeInTheDocument());

    // "comparison" appears only in a transcript line, never in a title.
    await user.type(screen.getByRole("searchbox"), "comparison");

    await waitFor(() => expect(screen.getByText(/1 result/)).toBeInTheDocument());
    expect(screen.getByText(/comparison table/i)).toBeInTheDocument();
  });

  it("requires every term to appear", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() => expect(screen.getByText("Pricing page rework")).toBeInTheDocument());

    await user.type(screen.getByRole("searchbox"), "pricing elephant");

    await waitFor(() => expect(screen.getByText(/nothing matches/)).toBeInTheDocument());
  });

  it("restores the grouped list when the query is cleared", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() => expect(screen.getByText("Pricing page rework")).toBeInTheDocument());

    const box = screen.getByRole("searchbox");
    await user.type(box, "comparison");
    await waitFor(() => expect(screen.getByText(/1 result/)).toBeInTheDocument());

    await user.clear(box);
    // Back to the library, not an empty result set.
    await waitFor(() => expect(screen.queryByText(/result/)).toBeNull());
    expect(screen.getByText("Monday standup")).toBeInTheDocument();
  });

  it("shows a note's tags and lets one be added", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Enhanced note");

    await waitFor(() => expect(screen.getByRole("button", { name: "pricing" })).toBeVisible());
    await user.click(screen.getByRole("button", { name: "+ Tag" }));
    await user.type(screen.getByRole("textbox", { name: "New tag" }), "Design Review{Enter}");

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

  it("narrows to tagged notes with tag:", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await openScenario(user, "Meetings");
    await waitFor(() => expect(screen.getByText("Monday standup")).toBeInTheDocument());

    await user.type(screen.getByRole("searchbox"), "tag:client");

    await waitFor(() => expect(screen.getByText(/1 result/)).toBeInTheDocument());
    expect(screen.getByText("Pricing page rework")).toBeInTheDocument();
    expect(screen.queryByText("Monday standup")).toBeNull();
  });

  it("clears the fake backend when it unmounts", async () => {
    const { hasBackend } = await import("../lib/ipc");
    const { unmount } = render(<Gallery />);
    expect(hasBackend()).toBe(true);

    unmount();
    expect(hasBackend()).toBe(false);
  });
});
