import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppearanceControl, defaultFamilies } from "../../design/appearance";
import { buildCommands } from "./commands";
import { Palette } from "./Palette";

afterEach(cleanup);

function setup(initialQuery = "") {
  const original = { theme: "terminal" as const, adjustments: {}, families: defaultFamilies() };
  const appearance = {
    appearance: original,
    setTheme: vi.fn(),
    setFamily: vi.fn(),
    setPreset: vi.fn(),
    setEffect: vi.fn(),
    setAxis: vi.fn(),
    reset: vi.fn(),
    restore: vi.fn(),
  } satisfies AppearanceControl;
  const noop = () => {};
  const commands = buildCommands({
    navigate: vi.fn(),
    searchLibrary: noop,
    stopMeeting: noop,
    openGallery: noop,
    recording: false,
    appearance,
  });
  const view = render(
    <Palette
      commands={commands}
      onOpenNote={noop}
      onSearchLibrary={noop}
      onClose={noop}
      appearance={appearance}
      initialQuery={initialQuery}
    />,
  );
  return { appearance, original, view };
}

describe("Palette previews", () => {
  it("try a theme on as the arrows reach it, and keep it on Enter", async () => {
    const user = userEvent.setup();
    const { appearance, view } = setup("theme");
    const input = screen.getByRole("combobox", { name: "Command" });

    expect(appearance.setTheme).not.toHaveBeenCalled();
    await user.type(input, "{ArrowDown}");
    expect(appearance.setTheme).toHaveBeenCalledTimes(1);

    await user.type(input, "{Enter}");
    view.unmount();
    expect(appearance.restore).not.toHaveBeenCalled();
  });

  it("put the look back when closed without Enter", async () => {
    const user = userEvent.setup();
    const { appearance, original, view } = setup("theme");
    await user.type(screen.getByRole("combobox", { name: "Command" }), "{ArrowDown}");

    view.unmount();
    expect(appearance.restore).toHaveBeenCalledWith(original);
  });

  it("show the original again once the arrows leave the looks", async () => {
    const user = userEvent.setup();
    const { appearance, original } = setup();
    const input = screen.getByRole("combobox", { name: "Command" });
    // Down from Start lands on Meetings, then on through to the themes.
    const toFirstTheme = "{ArrowDown}".repeat(6);
    await user.type(input, toFirstTheme);
    expect(appearance.setTheme).toHaveBeenCalledWith("terminal");
    await user.type(input, "{ArrowUp}");
    expect(appearance.restore).toHaveBeenCalledWith(original);
  });

  it("never preview while typing, so a theme cannot flash on the way to a word", async () => {
    const user = userEvent.setup();
    const { appearance } = setup();
    await user.type(screen.getByRole("combobox", { name: "Command" }), "vault");
    expect(appearance.setTheme).not.toHaveBeenCalled();
  });

  it("never preview under a passing mouse", async () => {
    const user = userEvent.setup();
    const { appearance } = setup();
    await user.hover(screen.getByRole("option", { name: /^vault/ }));
    expect(appearance.setTheme).not.toHaveBeenCalled();
  });
});
