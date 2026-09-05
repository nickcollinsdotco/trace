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

    await user.click(screen.getByRole("button", { name: "industrial" }));

    await waitFor(() => {
      expect(container.querySelector('[data-theme="industrial"]')).not.toBeNull();
    });
    // If the attribute landed on the root, the switcher itself would re-skin
    // and you could no longer tell the product from the tooling.
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("clears the fake backend when it unmounts", async () => {
    const { hasBackend } = await import("../lib/ipc");
    const { unmount } = render(<Gallery />);
    expect(hasBackend()).toBe(true);

    unmount();
    expect(hasBackend()).toBe(false);
  });
});
