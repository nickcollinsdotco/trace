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
 * Idle, it is a name and a Start. Recording, it is a bar — the live dot, the
 * time, both voices, and Stop. Stop is held, not clicked: the bar sits beside
 * the call's own controls, where one stray click would end a meeting that
 * cannot be resumed. Closing it only closes it; the meeting carries on.
 *
 * Only the grip drags the window, so a click is never mistaken for a drag.
 */
export function MiniWindow({ initial }: { initial?: MiniPhase } = {}) {
  const [phase, setPhase] = useState<MiniPhase>(initial ?? { kind: "idle" });
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    <div className="flex h-full flex-col overflow-hidden bg-surface-1 text-ink select-none">
      <div className="flex h-14 shrink-0 items-center gap-3 px-2">
        <span
          data-tauri-drag-region
          title="Drag to move"
          aria-hidden
          className="flex h-full w-4 cursor-grab items-center justify-center font-mono text-xs text-ink-faint"
        >
          ⋮
        </span>

        {phase.kind === "recording" && (
          <>
            <span aria-hidden className="inline-block size-2 shrink-0 rounded-full bg-error" />
            <button
              type="button"
              onClick={() => void ipc.showMain(null, false)}
              title="Back to TRACE"
              className="shrink-0 font-mono text-sm tabular-nums text-ink trace-press hover:text-phosphor"
            >
              {formatElapsed(phase.status.elapsedMs)}
            </button>
            <Scope mode="wave" label="Both voices, live" className="h-9 min-w-0 flex-1" />
            <HoldToStop onStop={stop} />
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

        <button
          type="button"
          onClick={() => void ipc.closeMini()}
          aria-label="Close the mini window"
          title="Close — a meeting keeps recording"
          className="flex size-7 shrink-0 items-center justify-center rounded-sm font-mono text-sm text-ink-faint trace-press hover:bg-surface-2 hover:text-ink"
        >
          ×
        </button>
      </div>

      {phase.kind === "idle" && (
        <form
          className="flex flex-col gap-3 px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <label className="flex items-center gap-2 border-b border-line pb-1 font-mono text-base">
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
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-sm border border-phosphor bg-phosphor-dim px-4 py-1.5 font-mono text-2xs uppercase tracking-system text-phosphor trace-press hover:bg-phosphor hover:text-surface-0"
            >
              Start meeting ↵
            </button>
            {error && <span className="truncate font-mono text-2xs text-error">{error}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Stop, held. The button fills as it is held, and a click alone only says
 * how to stop, so the bar beside a call's controls cannot end a meeting by
 * accident. Space or Enter held does the same from the keyboard.
 */
export function HoldToStop({ onStop }: { onStop: () => void }) {
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
    window.setTimeout(() => setHint(false), 1_600);
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
    <button
      type="button"
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => onKey(e, true)}
      onKeyUp={(e) => onKey(e, false)}
      aria-label="Stop meeting — hold to stop"
      className="relative shrink-0 overflow-hidden rounded-sm border border-error px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-error"
    >
      <span
        aria-hidden
        className="trace-hold-fill absolute inset-0 origin-left bg-error"
        data-holding={holding || undefined}
        style={{ animationDuration: `${HOLD_MS}ms` }}
      />
      <span className={`relative ${holding ? "text-surface-0" : ""}`}>
        {hint ? "hold" : "stop"}
      </span>
    </button>
  );
}
