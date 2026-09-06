import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

async function openEvery() {
  const user = userEvent.setup();
  render(<Gallery />);

  for (const scenario of SCENARIOS) {
    await user.click(screen.getByRole("button", { name: scenario.name }));
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
    await user.click(screen.getByRole("button", { name: "Meetings" }));

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
    await user.click(screen.getByRole("button", { name: "Recording" }));

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
    await user.click(screen.getByRole("button", { name: "Transcribing" }));

    await waitFor(() => expect(screen.getByText("transcribing")).toBeInTheDocument());
    expect(screen.getByText(/3.4s buffered/)).toBeInTheDocument();
  });

  it("distinguishes listening from transcribing", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Listening" }));

    // inFlight is 0 here: speech is buffered but the model is not running.
    await waitFor(() => expect(screen.getByText("listening")).toBeInTheDocument());
    expect(screen.queryByText("transcribing")).toBeNull();
  });

  it("still offers the setup panel where that is the point", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Before recording" }));

    await waitFor(() => expect(screen.getByText("Start meeting")).toBeInTheDocument());
    expect(screen.queryByText("Stop meeting")).toBeNull();
  });

  it("disables regeneration when the journal is gone", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Cannot be regenerated" }));

    const regenerate = await screen.findByRole("button", { name: "↻" });
    await waitFor(() => expect(regenerate).toBeDisabled());
    expect(regenerate).toHaveAttribute("title", expect.stringContaining("no longer on disk"));
  });

  it("still offers regeneration when the journal survives", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Enhanced note" }));

    const regenerate = await screen.findByRole("button", { name: "↻" });
    await waitFor(() => expect(regenerate).toBeEnabled());
  });

  it("shows the first-run report with measured facts, not placeholders", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Machine report" }));

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
    await user.click(screen.getByRole("button", { name: "Machine report" }));

    await waitFor(() => expect(screen.getByText("NICK-DESKTOP")).toBeInTheDocument());
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/DirectML/i);
    expect(text).toMatch(/ONNX Runtime/);
  });

  it("offers keeping the audio, off by default, with the disk cost stated", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Before recording" }));

    const toggle = await screen.findByRole("checkbox");
    expect(toggle).not.toBeChecked();
    // "Keep audio" without the figure is a choice made blind.
    expect(screen.getByText(/690 MB per hour/)).toBeInTheDocument();
  });

  it("reflects what the backend stored, not what the click assumed", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Before recording" }));

    const toggle = await screen.findByRole("checkbox");
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("offers rename and delete on a meeting", async () => {
    // Neither was reachable at all before: a library full of "ggg" and "dad2"
    // with no way to tidy it.
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Meetings" }));

    await waitFor(() => expect(screen.getByText("Pricing page rework")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Rename" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Delete" }).length).toBeGreaterThan(0);
  });

  it("removes a meeting from the list when deleted", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Meetings" }));
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
    await user.click(screen.getByRole("button", { name: "Meetings" }));
    await waitFor(() => expect(screen.getByText("Pricing page rework")).toBeInTheDocument());

    await user.click(screen.getAllByRole("button", { name: "Delete" })[1] as HTMLElement);

    // Still there. A destructive action that ignores "no" is worse than none.
    expect(screen.getByText("Pricing page rework")).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("offers discarding a recording in progress", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Recording" }));

    await waitFor(() => expect(screen.getByText("Stop meeting")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("gives a note a real heading outline", async () => {
    // A note is a document. Its sections were styled spans inside a
    // <header>, so a screen reader got no outline of it and no way to jump
    // between parts.
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Enhanced note" }));

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
    await user.click(screen.getByRole("button", { name: "Meetings" }));

    const row = await screen.findByRole("button", { name: "Pricing page rework" });
    expect(row.classList.contains("truncate")).toBe(true);
    expect(row.classList.contains("min-w-0")).toBe(true);
  });

  it("searches transcripts, not just titles, and says why each matched", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Meetings" }));
    await waitFor(() => expect(screen.getByText("Pricing page rework")).toBeInTheDocument());

    // "comparison" appears only in a transcript line, never in a title.
    await user.type(screen.getByRole("searchbox"), "comparison");

    await waitFor(() => expect(screen.getByText(/1 result/)).toBeInTheDocument());
    expect(screen.getByText(/comparison table/i)).toBeInTheDocument();
  });

  it("requires every term to appear", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Meetings" }));
    await waitFor(() => expect(screen.getByText("Pricing page rework")).toBeInTheDocument());

    await user.type(screen.getByRole("searchbox"), "pricing elephant");

    await waitFor(() => expect(screen.getByText(/nothing matches/)).toBeInTheDocument());
  });

  it("restores the grouped list when the query is cleared", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Meetings" }));
    await waitFor(() => expect(screen.getByText("Pricing page rework")).toBeInTheDocument());

    const box = screen.getByRole("searchbox");
    await user.type(box, "comparison");
    await waitFor(() => expect(screen.getByText(/1 result/)).toBeInTheDocument());

    await user.clear(box);
    // Back to the library, not an empty result set.
    await waitFor(() => expect(screen.queryByText(/result/)).toBeNull());
    expect(screen.getByText("Monday standup")).toBeInTheDocument();
  });

  it("clears the fake backend when it unmounts", async () => {
    const { hasBackend } = await import("../lib/ipc");
    const { unmount } = render(<Gallery />);
    expect(hasBackend()).toBe(true);

    unmount();
    expect(hasBackend()).toBe(false);
  });
});
