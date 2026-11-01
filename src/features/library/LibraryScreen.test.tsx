import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { makeBackend } from "../../fixtures/backend";
import { SCENARIOS } from "../../fixtures/scenarios";
import { installFakeBackend, ipc } from "../../lib/ipc";
import { LibraryScreen } from "./LibraryScreen";

afterEach(() => {
  cleanup();
  installFakeBackend(null);
  vi.restoreAllMocks();
});

function show(scenario: string) {
  installFakeBackend(makeBackend(SCENARIOS.find((s) => s.id === scenario)?.state));
  const settings = vi.fn();
  render(<LibraryScreen onNewMeeting={vi.fn()} onOpenNote={vi.fn()} onSettings={settings} />);
  return { user: userEvent.setup(), settings };
}

it("shows a disconnected library as unavailable and opens its settings", async () => {
  const { user, settings } = show("library-notes-unavailable");
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not read your notes");
  expect(screen.getByRole("alert")).toHaveTextContent("Reconnect the notes drive");
  expect(screen.queryByText("Your first meeting is one click away")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Notes folder settings" }));
  expect(settings).toHaveBeenCalledOnce();
});

it("retry clears an unavailable state only once the notes can be read again", async () => {
  const { user } = show("library-notes-unavailable");
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Try again" })).toBeEnabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Could not read your notes");

  vi.spyOn(ipc, "listNotes").mockResolvedValue(
    SCENARIOS.find((s) => s.id === "library")?.state.notes ?? [],
  );
  vi.spyOn(ipc, "notesRoot").mockResolvedValue("D:/Meeting notes");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByText("Pricing page rework", { selector: "[data-note-row] .trace-title" }),
  ).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

it("explains a failed migration above the still-usable original library", async () => {
  show("library-notes-copy-failed");
  expect(await screen.findByRole("alert")).toHaveTextContent("Notes folder change did not finish");
  expect(screen.getByRole("alert")).toHaveTextContent("Your original notes folder is still in use");
  expect(
    screen.getByText("Pricing page rework", { selector: "[data-note-row] .trace-title" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Notes folder settings" })).toBeEnabled();
});

it("keeps the first-meeting guidance for a successfully read empty library", async () => {
  show("library-empty");
  expect(await screen.findByText("Your first meeting is one click away")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
