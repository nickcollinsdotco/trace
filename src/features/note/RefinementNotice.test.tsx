import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Job, JobStep, StepKind } from "../../lib/ipc";
import { RefinementNotice } from "./RefinementNotice";

const NOW = Date.now();

function step(kind: StepKind, from?: number, to?: number): JobStep {
  return {
    ...kind,
    startedAt: from === undefined ? null : NOW + from,
    finishedAt: to === undefined ? null : NOW + to,
    failed: false,
    error: null,
  };
}

function job(steps: JobStep[], outcome: Job["outcome"] = null): Job {
  return { id: 1, notePath: "a.md", title: "A", queuedAt: NOW - 60_000, steps, outcome };
}

const part = (index: number, total: number): StepKind => ({ kind: "part", index, total });

describe("RefinementNotice", () => {
  it("says which part is being written, with a gauge of parts done", () => {
    render(
      <RefinementNotice
        job={job([
          step(part(1, 8), -90_000, -80_000),
          step(part(2, 8), -80_000, -70_000),
          step(part(3, 8), -70_000),
          step(part(4, 8)),
        ])}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("writing notes, part 3 of 8");
    expect(screen.getByRole("img", { name: "2 of 8 parts written" })).toBeInTheDocument();
  });

  it("says when the parts are being combined, instead of sitting on the last part", () => {
    render(
      <RefinementNotice
        job={job([step(part(8, 8), -20_000, -5_000), step({ kind: "combine" }, -5_000)])}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("combining 8 parts");
    expect(status).not.toHaveTextContent("part 8 of 8");
  });

  it("says a queued job is waiting, not stuck", () => {
    render(<RefinementNotice job={job([step({ kind: "transcript" }), step({ kind: "notes" })])} />);
    expect(screen.getByRole("status")).toHaveTextContent("waiting for another meeting's notes");
  });

  it("keeps the clock out of the live region, so it is not read out every second", () => {
    render(<RefinementNotice job={job([step({ kind: "transcript" }, -75_000)])} />);
    expect(screen.getByText("1m 15s")).toBeInTheDocument();
    expect(screen.getByRole("status")).not.toHaveTextContent("1m 15s");
  });

  it("opens into the steps with their timings", async () => {
    const user = userEvent.setup();
    render(
      <RefinementNotice
        job={job(
          [step({ kind: "transcript" }, -90_000, -52_000), step(part(1, 1), -52_000, -11_000)],
          { state: "generated", dropped: 0, fabricated: 0, uncited: 0 },
        )}
      />,
    );
    const toggle = screen.getByRole("button", { name: /notes generated/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("full-quality transcript")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("full-quality transcript")).toBeInTheDocument();
    expect(screen.getByText("38s")).toBeInTheDocument();
    expect(screen.getByText("41s")).toBeInTheDocument();
  });

  it("says notes came from the live transcript, and why, when the pass failed", async () => {
    const user = userEvent.setup();
    render(
      <RefinementNotice
        job={job(
          [
            {
              ...step({ kind: "transcript" }, -60_000, -58_000),
              failed: true,
              error: "the transcription model did not load (missing file)",
            },
            step(part(1, 1), -58_000, -10_000),
          ],
          { state: "generated", dropped: 0, fabricated: 0, uncited: 0 },
        )}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Notes generated from the live transcript",
    );
    const toggle = screen.getByRole("button", { name: /notes generated from the live transcript/ });

    await user.click(toggle);
    expect(
      screen.getByText("└ the transcription model did not load (missing file)"),
    ).toBeInTheDocument();
  });

  it("counts discarded items rather than quietly showing fewer", () => {
    render(
      <RefinementNotice
        job={job([step(part(1, 1), -9_000, 0)], {
          state: "generated",
          dropped: 2,
          fabricated: 2,
          uncited: 0,
        })}
      />,
    );
    expect(
      screen.getByText("2 items discarded for citing something not in the transcript"),
    ).toBeInTheDocument();
  });

  it("says the transcript is safe when notes fail", () => {
    render(
      <RefinementNotice
        job={job([step({ kind: "notes" }, -1_000, 0)], {
          state: "failed",
          message: "Ollama is not running",
        })}
      />,
    );
    expect(
      screen.getByText(
        /notes could not be generated — Ollama is not running\. The transcript is saved\./,
      ),
    ).toBeInTheDocument();
  });
});
