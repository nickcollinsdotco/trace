import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { formatElapsed, Prompt } from "../../components/ui/terminal";
import { type CaptureStatus, hasBackend, ipc, onCaptureChanged } from "../../lib/ipc";
import { Scope } from "../scope/Scope";

/** How long Stop must be held (docs/13 Q26). Long enough to be deliberate. */
export const HOLD_MS = 600;
/** How long "saved" stays before the window closes itself. */
const SAVED_MS = 4_000;
const POLL_MS = 500;

export type MiniPhase =
  | { kind: "idle" }
  | { kind: "recording"; status: CaptureStatus }
  | { kind: "saving" }
  | { kind: "saved"; notePath: string };

/**
 * The mini window (CONTEXT.md): a meeting in a strip that floats over
 * everything, for when TRACE itself is behind the call.
 *
 * Shaped after the mini players people already know — Spotify's, Apple
 * Music's, Recordly's bar: one round button carries the whole thing, the
 * name leads and the time sits under it, and anything secondary waits for
 * the pointer before it appears. Idle, it is a name and a round red Start.
 * Recording, it is a bar: the name, the time, both voices, and a round Stop
 * that has to be held — the bar sits beside the call's own controls, where
 * one stray click would end a meeting that cannot be resumed. Closing it
 * only closes it; the meeting carries on.
 *
 * Only the ⠿ grip drags the window, so a click is never mistaken for a drag.
 */
export function MiniWindow({ initial }: { initial?: MiniPhase } = {}) {
  const [phase, setPhase] = useState<MiniPhase>(initial ?? { kind: "idle" });
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Whether a meeting is running, kept current: polled, and asked again the
  // moment either window starts or stops one.
  const refresh = useCallback(() => {
    if (!hasBackend()) return;
    void ipc
      .captureStatus()
      .then((status) => {
        const now = phaseRef.current.kind;
        if (now === "saving" || now === "saved") return;
        setPhase(status ? { kind: "recording", status } : { kind: "idle" });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initial) return;
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    let unlisten: (() => void) | undefined;
    void onCaptureChanged(refresh).then((u) => {
      unlisten = u;
    });
    return () => {
      window.clearInterval(id);
      unlisten?.();
    };
  }, [initial, refresh]);

  // The bar while recording; the taller window for a name and a Start.
  const expanded = phase.kind === "idle";
  useEffect(() => {
    if (initial || !hasBackend()) return;
    void ipc.setMiniExpanded(expanded).catch(() => {});
  }, [expanded, initial]);

  async function start() {
    setError(null);
    try {
      await ipc.startCapture(title, null);
      setTitle("");
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function stop() {
    setPhase({ kind: "saving" });
    try {
      const finished = await ipc.stopCapture();
      setPhase({ kind: "saved", notePath: finished.notePath });
      // Flash TRACE in the taskbar and open the note there, so coming back
      // lands on it — rather than snatching focus from the call (Q26).
      await ipc.showMain(finished.notePath, true).catch(() => {});
      window.setTimeout(() => void ipc.closeMini().catch(() => {}), SAVED_MS);
    } catch (e) {
      setError(String(e));
      refresh();
    }
  }

  return (
    <div className="group flex h-full flex-col overflow-hidden bg-surface-1 text-ink select-none">
      <div className="flex h-14 shrink-0 items-center gap-3 pr-2 pl-1">
        <Grip />

        {phase.kind === "recording" && (
          <>
            <button
              type="button"
              onClick={() => void ipc.showMain(null, false)}
              title="Back to TRACE"
              className="flex min-w-0 shrink flex-col items-start text-left trace-press"
            >
              <span className="flex max-w-36 items-center gap-1.5 truncate text-sm text-ink">
                <span
                  aria-hidden
                  className="inline-block size-1.5 shrink-0 rounded-full bg-error"
                />
                <span className="truncate">{phase.status.title || "Untitled meeting"}</span>
              </span>
              {/* A click on Stop is answered here, under the name, where the
                  eye already is — not over the waveform. */}
              <span
                className={`font-mono text-2xs tabular-nums ${hint ? "text-error" : "text-ink-muted"}`}
              >
                {hint ? "hold to stop" : formatElapsed(phase.status.elapsedMs)}
              </span>
            </button>
            <Scope mode="wave" label="Both voices, live" className="h-9 min-w-0 flex-1" />
            <HoldToStop onStop={stop} onHint={setHint} />
          </>
        )}

        {phase.kind === "saving" && (
          <p className="min-w-0 flex-1 font-mono text-xs text-ink-muted">
            <Prompt />
            saving…
          </p>
        )}

        {phase.kind === "saved" && (
          <p className="flex min-w-0 flex-1 items-center gap-2 font-mono text-xs text-ink-muted">
            <span className="text-phosphor">✓ saved</span>· writing notes…
            <button
              type="button"
              onClick={() => {
                void ipc.showMain(phase.notePath, false);
                void ipc.closeMini();
              }}
              className="ml-auto rounded-xs px-1.5 text-phosphor trace-press hover:underline"
            >
              open
            </button>
          </p>
        )}

        {phase.kind === "idle" && (
          <span className="min-w-0 flex-1 font-mono text-xs uppercase tracking-system text-ink-muted">
            TRACE
          </span>
        )}

        <Secondary recording={phase.kind === "recording"} />
      </div>

      {phase.kind === "idle" && (
        <form
          className="flex items-center gap-3 px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label className="flex items-center gap-2 border-b border-line pb-1 font-mono text-base focus-within:border-phosphor">
              <span className="text-phosphor">
                <Prompt />
              </span>
              <span className="sr-only">Meeting name</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled meeting"
                // biome-ignore lint/a11y/noAutofocus: opened by a shortcut to type a name
                autoFocus
                spellCheck={false}
                data-selectable
                className="trace-mini-field min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint"
              />
            </label>
            <span className="font-mono text-2xs text-ink-faint">
              {error ?? "enter, or the red button, to start"}
            </span>
          </div>
          <button
            type="submit"
            aria-label="Start meeting"
            title="Start meeting (Enter)"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-error trace-press hover:brightness-110"
          >
            <span aria-hidden className="size-4 rounded-full bg-surface-0" />
          </button>
        </form>
      )}
    </div>
  );
}

/** The six-dot grip every mini player uses; the only part that drags. */
function Grip() {
  return (
    <span
      data-tauri-drag-region
      title="Drag to move"
      aria-hidden
      className="flex h-full w-5 shrink-0 cursor-grab items-center justify-center text-ink-faint"
    >
      <svg
        width="8"
        height="14"
        viewBox="0 0 8 14"
        fill="currentColor"
        className="pointer-events-none"
        aria-hidden
      >
        {[1, 7].flatMap((x) =>
          [2, 7, 12].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />),
        )}
      </svg>
    </span>
  );
}

/**
 * Back to TRACE, and close — there when the pointer is, faded when it is
 * not, as Spotify's mini player keeps its own corners clear. Always there to
 * the keyboard: focus shows them too.
 */
function Secondary({ recording }: { recording: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 opacity-40 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
      {recording && (
        <button
          type="button"
          onClick={() => void ipc.showMain(null, false)}
          aria-label="Back to TRACE"
          title="Back to TRACE"
          className="flex size-7 items-center justify-center rounded-sm text-ink-faint trace-press hover:bg-surface-2 hover:text-ink"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden
          >
            <path d="M4.5 2.5h5v5M9.5 2.5 3 9" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={() => void ipc.closeMini()}
        aria-label="Close the mini window"
        title="Close — a meeting keeps recording"
        className="flex size-7 items-center justify-center rounded-sm font-mono text-sm text-ink-faint trace-press hover:bg-surface-2 hover:text-ink"
      >
        ×
      </button>
    </span>
  );
}

/**
 * Stop, held: a round red button whose ring fills while it is held. A click
 * alone only says how to stop, so a bar beside a call's controls cannot end
 * a meeting by accident. Space or Enter held does the same from the keyboard.
 */
export function HoldToStop({
  onStop,
  onHint,
}: {
  onStop: () => void;
  /** Told when a click needs explaining, so it can be shown where it reads. */
  onHint?: (showing: boolean) => void;
}) {
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const timer = useRef<number | null>(null);

  const begin = () => {
    if (timer.current !== null) return;
    setHint(false);
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onStop();
    }, HOLD_MS);
  };

  const cancel = () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    setHint(true);
    onHint?.(true);
    window.setTimeout(() => {
      setHint(false);
      onHint?.(false);
    }, 1_600);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, down: boolean) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (down && !e.repeat) begin();
    if (!down) cancel();
  };

  return (
    <span className="relative flex shrink-0 items-center">
      <span role="status" className="sr-only">
        {hint ? "hold to stop" : ""}
      </span>
      <button
        type="button"
        onPointerDown={begin}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onKeyDown={(e) => onKey(e, true)}
        onKeyUp={(e) => onKey(e, false)}
        aria-label="Stop meeting — hold to stop"
        title="Hold to stop"
        className="relative flex size-10 items-center justify-center rounded-full bg-error/15 trace-press hover:bg-error/25"
      >
        {/* The ring that fills while held. A stroke drawn round, so it reads
            as a countdown rather than a bar. */}
        <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle
            cx="20"
            cy="20"
            r="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-error/35"
          />
          <circle
            cx="20"
            cy="20"
            r="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            pathLength={1}
            className="trace-hold-ring text-error"
            data-holding={holding || undefined}
            style={{ animationDuration: `${HOLD_MS}ms` }}
          />
        </svg>
        <span aria-hidden className="relative size-3.5 rounded-xs bg-error" />
      </button>
    </span>
  );
}
