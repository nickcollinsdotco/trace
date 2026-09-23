import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Job } from "../../lib/ipc";
import { ActivityToast } from "./ActivityToast";

const running: Job = {
  id: 7,
  notePath: "a.md",
  title: "Weekly sync",
  queuedAt: 0,
  steps: [{ kind: "notes", startedAt: 1, finishedAt: null, failed: false }],
  outcome: null,
};
const done: Job = {
  ...running,
  steps: [{ kind: "notes", startedAt: 1, finishedAt: 2, failed: false }],
  outcome: { state: "generated", dropped: 0, fabricated: 0, uncited: 0 },
};

describe("ActivityToast", () => {
  it("says notes are ready when they finish while the user is elsewhere", () => {
    const { rerender } = render(
      <ActivityToast jobs={[running]} openNote={null} onOpenNote={() => {}} />,
    );
    expect(screen.queryByText(/notes ready/)).toBeNull();

    rerender(<ActivityToast jobs={[done]} openNote={null} onOpenNote={() => {}} />);
    expect(screen.getByText(/notes ready/)).toHaveTextContent("Weekly sync");
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("stays quiet on the note itself, which already says so", () => {
    const { rerender } = render(<ActivityToast jobs={[running]} openNote="a.md" />);
    rerender(<ActivityToast jobs={[done]} openNote="a.md" />);
    expect(screen.queryByText(/notes ready/)).toBeNull();
  });

  it("treats a job already finished when first seen as history, not news", () => {
    render(<ActivityToast jobs={[done]} openNote={null} />);
    expect(screen.queryByText(/notes ready/)).toBeNull();
  });

  it("says so when notes could not be written", () => {
    const { rerender } = render(<ActivityToast jobs={[running]} openNote={null} />);
    rerender(
      <ActivityToast
        jobs={[{ ...done, outcome: { state: "failed", message: "Ollama closed" } }]}
        openNote={null}
      />,
    );
    expect(screen.getByText(/notes could not be written/)).toBeInTheDocument();
  });
});
