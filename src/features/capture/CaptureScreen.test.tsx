import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeBackend } from "../../fixtures/backend";
import { scenarioById } from "../../fixtures/scenarios";
import { installFakeBackend } from "../../lib/ipc";
import { CaptureScreen } from "./CaptureScreen";

afterEach(() => {
  cleanup();
  installFakeBackend(null);
});

/**
 * The palette's Stop reaches the backend through this screen, so the notes
 * typed in the last moment are flushed first. These pin that route.
 */
describe("CaptureScreen stop request", () => {
  function recording() {
    const backend = makeBackend(scenarioById("capture-live")?.state);
    const invoke = vi.spyOn(backend, "invoke");
    installFakeBackend(backend);
    return invoke;
  }

  it("stops a running meeting once, and hands back its note", async () => {
    const invoke = recording();
    const onFinish = vi.fn();
    const { rerender } = render(<CaptureScreen onFinish={onFinish} stopRequest={1} />);

    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    expect(onFinish.mock.calls[0]?.[0]).toMatch(/\.md$/);

    // The same request again — a re-render — must not stop a second time.
    rerender(<CaptureScreen onFinish={onFinish} stopRequest={1} />);
    const stops = invoke.mock.calls.filter(([command]) => command === "stop_capture");
    expect(stops).toHaveLength(1);
  });

  it("does nothing without a request", async () => {
    const invoke = recording();
    render(<CaptureScreen onFinish={vi.fn()} />);
    await waitFor(() =>
      expect(invoke.mock.calls.some(([command]) => command === "capture_status")).toBe(true),
    );
    expect(invoke.mock.calls.some(([command]) => command === "stop_capture")).toBe(false);
  });
});

/**
 * Each save is the meeting's whole notes, so a recording screen that opened
 * empty replaced everything typed before it was left with its first
 * keystroke. These pin the screen to the notes the meeting already has.
 */
describe("CaptureScreen notes", () => {
  function recording() {
    const backend = makeBackend(scenarioById("capture-live")?.state);
    const invoke = vi.spyOn(backend, "invoke");
    installFakeBackend(backend);
    return { backend, invoke };
  }

  const field = () => screen.getByPlaceholderText<HTMLTextAreaElement>("type only what matters…");

  async function editable() {
    await waitFor(() => expect(field().readOnly).toBe(false));
    return field();
  }

  function saved(invoke: ReturnType<typeof recording>["invoke"]) {
    return invoke.mock.calls
      .filter(([command]) => command === "update_notes")
      .map(([, args]) => (args as { text: string }).text);
  }

  it("brings back what was typed when the screen is opened again", async () => {
    const { invoke } = recording();
    const first = render(<CaptureScreen onFinish={vi.fn()} />);
    fireEvent.change(await editable(), { target: { value: "decisions so far" } });
    // Left inside the debounce: the words exist only in the screen.
    first.unmount();

    render(<CaptureScreen onFinish={vi.fn()} />);
    expect((await editable()).value).toBe("decisions so far");

    // The next keystroke extends the notes rather than replacing them.
    fireEvent.change(field(), { target: { value: "decisions so far\nand one more" } });
    cleanup();
    await waitFor(() => expect(saved(invoke).at(-1)).toBe("decisions so far\nand one more"));
    expect(saved(invoke)).not.toContain("and one more");
  });

  it("keeps the field read-only until the saved notes have arrived", async () => {
    const { backend } = recording();
    await backend.invoke("update_notes", { text: "written earlier" });

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = backend.invoke.bind(backend);
    vi.spyOn(backend, "invoke").mockImplementation(async (command, args) => {
      if (command === "capture_notes") await gate;
      return real(command, args);
    });

    render(<CaptureScreen onFinish={vi.fn()} />);
    await waitFor(() => expect(field()).toBeTruthy());
    expect(field().readOnly).toBe(true);
    // A keystroke that gets through anyway must not become the notes.
    fireEvent.change(field(), { target: { value: "x" } });
    expect(field().value).toBe("");

    release();
    expect((await editable()).value).toBe("written earlier");
  });

  it("keeps a scope-view line written while the notes are loading", async () => {
    const { backend } = recording();
    await backend.invoke("update_notes", { text: "written earlier" });

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = backend.invoke.bind(backend);
    const invoke = vi.spyOn(backend, "invoke").mockImplementation(async (command, args) => {
      if (command === "capture_notes") await gate;
      return real(command, args);
    });

    render(<CaptureScreen onFinish={vi.fn()} initialScopeView />);
    const line = await screen.findByPlaceholderText("a line for the notes, then enter");
    expect(field().readOnly).toBe(true);
    fireEvent.change(line, { target: { value: "from the scope" } });
    fireEvent.keyDown(line, { key: "Enter" });

    release();
    expect((await editable()).value).toBe("written earlier\nfrom the scope");
    cleanup();
    await waitFor(() => expect(saved(invoke).at(-1)).toBe("written earlier\nfrom the scope"));
  });
});
