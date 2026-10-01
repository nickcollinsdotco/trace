import { cleanup, render, waitFor } from "@testing-library/react";
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
