import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextMenuProvider, useContextMenu } from "./ContextMenu";

function Row({ onRename }: { onRename: () => void }) {
  const menu = useContextMenu("Actions for Weekly sync", () => [
    { label: "Open", onSelect: () => {} },
    { label: "Rename", hint: "F2", onSelect: onRename },
    "divider",
    { label: "Delete", danger: true, disabled: true, onSelect: () => {} },
  ]);
  return (
    <div {...menu} data-testid="row">
      Weekly sync
    </div>
  );
}

function setup() {
  const onRename = vi.fn();
  render(
    <ContextMenuProvider>
      <Row onRename={onRename} />
      <input aria-label="Search" />
      <p>Elsewhere</p>
    </ContextMenuProvider>,
  );
  return { onRename, user: userEvent.setup() };
}

describe("ContextMenu", () => {
  it("opens on right-click with the row's actions, and acts on one", async () => {
    const { onRename, user } = setup();
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(screen.getByRole("menu", { name: "Actions for Weekly sync" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeDisabled();

    await user.click(screen.getByRole("menuitem", { name: /Rename/ }));
    expect(onRename).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves with the arrows, skipping what cannot be chosen, and Escape closes it", async () => {
    const { user } = setup();
    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Rename/ })).toHaveFocus();
    // Delete is disabled, so down again comes round to the top.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a click outside it", async () => {
    const { user } = setup();
    fireEvent.contextMenu(screen.getByTestId("row"));
    await user.click(screen.getByText("Elsewhere"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("turns off the web page's menu, except in fields", () => {
    setup();
    // fireEvent returns false when the default was prevented.
    expect(fireEvent.contextMenu(screen.getByText("Elsewhere"))).toBe(false);
    expect(fireEvent.contextMenu(screen.getByRole("textbox", { name: "Search" }))).toBe(true);
  });

  it("leaves selected text to the browser, for Copy", () => {
    render(
      <ContextMenuProvider>
        <Row onRename={() => {}} />
      </ContextMenuProvider>,
    );
    const row = screen.getByTestId("row");
    const range = document.createRange();
    range.selectNodeContents(row);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(fireEvent.contextMenu(row)).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    window.getSelection()?.removeAllRanges();
  });
});
