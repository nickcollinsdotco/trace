import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, HoldToStop } from "./MiniWindow";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * Stop in the mini window sits beside a call's own controls, where one stray
 * click would end a meeting that cannot be resumed (docs/13 Q26).
 */
describe("hold to stop", () => {
  it("never stops on a click, and says how to", () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    render(<HoldToStop onStop={onStop} />);
    const button = screen.getByRole("button", { name: /hold to stop/ });

    fireEvent.pointerDown(button);
    act(() => vi.advanceTimersByTime(120));
    fireEvent.pointerUp(button);
    act(() => vi.advanceTimersByTime(HOLD_MS));

    expect(onStop).not.toHaveBeenCalled();
    expect(button).toHaveTextContent("hold");
  });

  it("stops once held for the full time", () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    render(<HoldToStop onStop={onStop} />);
    const button = screen.getByRole("button", { name: /hold to stop/ });

    fireEvent.pointerDown(button);
    act(() => vi.advanceTimersByTime(HOLD_MS + 10));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("lets go if the pointer slides off before the end", () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    render(<HoldToStop onStop={onStop} />);
    const button = screen.getByRole("button", { name: /hold to stop/ });

    fireEvent.pointerDown(button);
    act(() => vi.advanceTimersByTime(HOLD_MS / 2));
    fireEvent.pointerLeave(button);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onStop).not.toHaveBeenCalled();
  });

  it("holds from the keyboard too, and a tap is not a hold", () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    render(<HoldToStop onStop={onStop} />);
    const button = screen.getByRole("button", { name: /hold to stop/ });

    fireEvent.keyDown(button, { key: " " });
    fireEvent.keyUp(button, { key: " " });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onStop).not.toHaveBeenCalled();

    fireEvent.keyDown(button, { key: "Enter" });
    act(() => vi.advanceTimersByTime(HOLD_MS + 10));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
