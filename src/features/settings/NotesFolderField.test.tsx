import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../../components/ui/Confirm";
import { makeBackend } from "../../fixtures/backend";
import { installFakeBackend, ipc } from "../../lib/ipc";
import { NotesFolderField } from "./NotesFolderField";

afterEach(() => {
  cleanup();
  installFakeBackend(null);
  vi.restoreAllMocks();
});

function setup() {
  installFakeBackend(makeBackend());
  render(
    <ConfirmProvider>
      <NotesFolderField />
    </ConfirmProvider>,
  );
  return userEvent.setup();
}

it("queues only after confirmation, keeps the current root and can cancel", async () => {
  const user = setup();
  const queue = vi.spyOn(ipc, "scheduleNotesFolder");
  await screen.findByText("C:\\Users\\you\\Documents\\TRACE");
  await user.click(screen.getByRole("button", { name: "Choose folder…" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent(
    "Original files stay in the old folder",
  );
  expect(queue).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Use on next launch" }));
  expect(queue).toHaveBeenCalledWith("D:/Meeting notes");
  expect(await screen.findByRole("status")).toHaveTextContent("On next launch:");
  expect(screen.getByText("C:\\Users\\you\\Documents\\TRACE")).toBeInTheDocument();
  expect(await ipc.notesRoot()).toBe("C:\\Users\\you\\Documents\\TRACE");
  await user.click(screen.getByRole("button", { name: "Cancel folder change" }));
  expect(queue).toHaveBeenLastCalledWith(null);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("does not queue a cancelled picker or a declined confirmation", async () => {
  const user = setup();
  const queue = vi.spyOn(ipc, "scheduleNotesFolder");
  const picker = vi.spyOn(ipc, "chooseNotesFolder").mockResolvedValueOnce(null);
  await screen.findByText("C:\\Users\\you\\Documents\\TRACE");
  await user.click(screen.getByRole("button", { name: "Choose folder…" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(queue).not.toHaveBeenCalled();
  picker.mockResolvedValueOnce("D:/Meeting notes");
  await user.click(screen.getByRole("button", { name: "Choose folder…" }));
  await user.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(queue).not.toHaveBeenCalled();
});

it("shows a refused destination without claiming it was saved", async () => {
  const user = setup();
  vi.spyOn(ipc, "scheduleNotesFolder").mockRejectedValueOnce(
    "Choose an empty folder. Existing files are never overwritten.",
  );
  await screen.findByText("C:\\Users\\you\\Documents\\TRACE");
  await user.click(screen.getByRole("button", { name: "Choose folder…" }));
  await user.click(await screen.findByRole("button", { name: "Use on next launch" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Choose an empty folder");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("C:\\Users\\you\\Documents\\TRACE")).toBeInTheDocument();
});

it("shows a failed startup copy with its pending destination and safe cancellation", async () => {
  installFakeBackend(
    makeBackend({
      notesFolder: {
        current: "C:/Old notes",
        pending: "D:/New notes",
        error: "A different file already exists. Nothing was overwritten.",
      },
    }),
  );
  const user = userEvent.setup();
  render(
    <ConfirmProvider>
      <NotesFolderField />
    </ConfirmProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was overwritten");
  expect(screen.getByRole("status")).toHaveTextContent("D:/New notes");
  expect(screen.getByText("C:/Old notes")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel folder change" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("C:/Old notes")).toBeInTheDocument();
});
