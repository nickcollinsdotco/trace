import { describe, expect, it } from "vitest";
import { hasRealModifier, shortcutFromEvent, shortcutLabel } from "./shortcut";

const press = (
  code: string,
  mods: Partial<Record<"ctrl" | "shift" | "alt" | "meta", boolean>>,
) => ({
  key: code.replace(/^Key/, "").toLowerCase(),
  code,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
});

describe("a recorded shortcut", () => {
  it("is written as the backend parses it, modifiers in a fixed order", () => {
    expect(shortcutFromEvent(press("KeyM", { alt: true, ctrl: true, shift: true }))).toBe(
      "Ctrl+Shift+Alt+M",
    );
    expect(shortcutFromEvent(press("Digit5", { ctrl: true }))).toBe("Ctrl+5");
    expect(shortcutFromEvent(press("F9", { meta: true }))).toBe("Super+F9");
  });

  it("goes by the key pressed, not the character the layout makes of it", () => {
    // Shift+Alt+M on some layouts types "Μ" or nothing; the key is still M.
    const e = { ...press("KeyM", { shift: true, alt: true }), key: "Μ" };
    expect(shortcutFromEvent(e)).toBe("Shift+Alt+M");
  });

  it("waits while only modifiers are down", () => {
    expect(shortcutFromEvent({ ...press("ControlLeft", { ctrl: true }), key: "Control" })).toBe(
      null,
    );
  });

  it("needs Ctrl, Alt or the Windows key, not Shift alone", () => {
    expect(hasRealModifier("Ctrl+Shift+Alt+M")).toBe(true);
    expect(hasRealModifier("Super+F9")).toBe(true);
    expect(hasRealModifier("Shift+M")).toBe(false);
    expect(hasRealModifier("M")).toBe(false);
  });

  it("names the Windows key as Windows does", () => {
    expect(shortcutLabel("Super+Shift+F9")).toBe("Win+Shift+F9");
  });
});
