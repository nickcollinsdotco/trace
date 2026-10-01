import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installMotion, type Motion, scrambleFrame } from "./motion";

beforeAll(() => installMotion());
afterEach(() => {
  document.body.innerHTML = "";
});

/** A shell in the given motion, holding one pressable control. */
function control(motion: Motion, label = "New meeting", disabled = false): HTMLButtonElement {
  document.body.innerHTML = `
    <div data-motion="${motion}">
      <div class="trace-shell">
        <button class="trace-press" ${disabled ? "disabled" : ""}><span>${label}</span></button>
      </div>
    </div>`;
  return document.querySelector("button") as HTMLButtonElement;
}

function pointer(type: string, target: Element, extra: Record<string, unknown> = {}) {
  const e = new MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: 10 });
  Object.defineProperty(e, "pointerType", { value: "mouse" });
  for (const [k, v] of Object.entries(extra)) Object.defineProperty(e, k, { value: v });
  target.dispatchEvent(e);
}

const settle = () => new Promise((r) => setTimeout(r, 450));

describe("scrambleFrame", () => {
  const random = () => 0.5;

  it("keeps the length and the spaces, so word shapes survive", () => {
    const frame = scrambleFrame("New meeting", 0, random);
    expect(frame).toHaveLength("New meeting".length);
    expect(frame[3]).toBe(" ");
    expect(frame).not.toBe("New meeting");
  });

  it("settles left to right, and is the label itself at the end", () => {
    expect(scrambleFrame("Models", 0.5, random).slice(0, 3)).toBe("Mod");
    expect(scrambleFrame("Models", 1, random)).toBe("Models");
  });
});

describe("presses", () => {
  it("throw a burst of glyphs for scramble", () => {
    pointer("pointerdown", control("scramble"));
    const fx = document.querySelector(".trace-press-fx-scramble");
    expect(fx).not.toBeNull();
    expect(fx?.textContent?.trim()).not.toBe("");
    // Drawn in the shell, so the gallery's preview themes it.
    expect(fx?.parentElement?.classList.contains("trace-shell")).toBe(true);
  });

  it("spread a ripple for ripple", () => {
    pointer("pointerdown", control("ripple"));
    expect(document.querySelector(".trace-press-fx-ripple .trace-press-fx-mark")).not.toBeNull();
  });

  it("do nothing when motion is off, or the control is disabled", () => {
    pointer("pointerdown", control("off"));
    expect(document.querySelector(".trace-press-fx")).toBeNull();
    pointer("pointerdown", control("scramble", "Start", true));
    expect(document.querySelector(".trace-press-fx")).toBeNull();
  });
});

describe("the hover scramble", () => {
  it("scrambles a label and puts it back exactly", async () => {
    const button = control("scramble");
    const text = button.querySelector("span")?.firstChild as Text;
    pointer("pointerover", button);
    await new Promise((r) => setTimeout(r, 60));
    expect(text.data).not.toBe("New meeting");
    await settle();
    expect(text.data).toBe("New meeting");
    // The width it was pinned to while scrambling is let go.
    expect(button.style.width).toBe("");
  });

  it("leaves rippling labels alone", async () => {
    const button = control("ripple");
    pointer("pointerover", button);
    await new Promise((r) => setTimeout(r, 60));
    expect(button.textContent).toBe("New meeting");
  });

  it("gives way when the label is rewritten mid-scramble", async () => {
    const button = control("scramble");
    const text = button.querySelector("span")?.firstChild as Text;
    pointer("pointerover", button);
    await new Promise((r) => setTimeout(r, 60));
    // What React would do on a re-render: the new label must survive.
    text.data = "Recording";
    await settle();
    expect(text.data).toBe("Recording");
  });

  it("skips prose-length labels", async () => {
    const button = control("scramble", "An informal catch-up with Dev about the week");
    pointer("pointerover", button);
    await new Promise((r) => setTimeout(r, 60));
    expect(button.textContent).toBe("An informal catch-up with Dev about the week");
  });
});
