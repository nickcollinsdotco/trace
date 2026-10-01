import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { formatElapsed, Prompt } from "../../components/ui/terminal";
import { type CaptureStatus, hasBackend, ipc, onCaptureChanged } from "../../lib/ipc";
import { Scope } from "../scope/Scope";

/** How long Stop must be held (docs/13 Q26). Long enough to be deliberate. */
export const HOLD_MS = 600;
/** How long "saved" stays before the window closes itself. */
const SAVED_MS = 4_000;
const POLL_MS = 500;
const WAVE_KEY = "trace.mini.wave";
/** The window's usual width, which it returns to once content fits again. */
const BAR_WIDTH = 360;

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
 * Music's, Recordly's bar: one round button carries it, and anything
 * secondary waits for the pointer.
 *
 * One bar, whatever the state, so nothing jumps when a meeting starts: the
 * name field sits where the meeting's name will be, and the round red Start
 * sits exactly where Stop will. Starting swaps the one for the other and
 * nothing else moves. Stop has to be held — the bar sits beside a call's own
 * controls, where one stray click would end a meeting that cannot be
 * resumed. Closing it only closes it; the meeting carries on.
 *
 * Only the ⠿ grip drags the window, so a click is never mistaken for a drag.
 */
export function MiniWindow({ initial }: { initial?: MiniPhase } = {}) {
  const [phase, setPhase] = useState<MiniPhase>(initial ?? { kind: "idle" });
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [wave, setWave] = useWave();
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

  const recording = phase.kind === "recording";

  // Grow to fit rather than wrap. A theme in capitals or a wide typeface can
  // need more than the usual width, and a second line in a 56px bar is cut
  // in half. Measured after each change of state, once the fonts are in,
  // and when the theme changes in the other window.
  const root = useRef<HTMLDivElement>(null);
  const kind = phase.kind;
  useLayoutEffect(() => {
    if (initial || !hasBackend()) return;
    const measure = () => {
      const el = root.current;
      if (!el) return;
      if (el.scrollWidth > el.clientWidth + 1) {
        void ipc.fitMini(el.scrollWidth + 4).catch(() => {});
      } else if (kind === "idle" || kind === "recording") {
        // Their middles stretch, so they always fit; back to the usual size.
        void ipc.fitMini(BAR_WIDTH).catch(() => {});
      }
    };
    measure();
    void document.fonts?.ready.then(measure);
    window.addEventListener("storage", measure);
    return () => window.removeEventListener("storage", measure);
  }, [kind, initial]);

  return (
    <div
      ref={root}
      className="group flex h-full items-center gap-2 overflow-hidden bg-surface-1 pr-1.5 pl-1 text-ink select-none"
    >
      <Grip />

      <div className="flex min-w-0 flex-1 items-center gap-3">
        {phase.kind === "idle" && (
          <form
            className="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <label className="flex items-center gap-1.5 font-mono text-sm">
              <span className="text-phosphor">
                <Prompt />
              </span>
              <span className="sr-only">Meeting name</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                // A failure is said where the name goes, so the bar keeps its
                // one row and its shape.
                placeholder={error ? `couldn't start: ${error}` : "name this meeting"}
                aria-invalid={error !== null}
                // biome-ignore lint/a11y/noAutofocus: opened to type a name
                autoFocus
                spellCheck={false}
                data-selectable
                className={`trace-mini-field min-w-0 flex-1 bg-transparent text-ink ${
                  error ? "placeholder:text-error" : "placeholder:text-ink-faint"
                }`}
              />
            </label>
          </form>
        )}

        {phase.kind === "recording" && (
          <>
            <button
              type="button"
              onClick={() => void ipc.showMain(null, false)}
              title="Back to TRACE"
              className="flex min-w-0 shrink flex-col items-start text-left trace-press"
            >
              <span className="max-w-40 truncate text-sm text-ink">
                {phase.status.title || "Untitled meeting"}
              </span>
              {/* A click on Stop is answered here, under the name, where the
                  eye already is — not over the waveform. */}
              <span
                className={`font-mono text-2xs tabular-nums ${hint ? "text-error" : "text-ink-muted"}`}
              >
                {hint ? "hold to stop" : formatElapsed(phase.status.elapsedMs)}
              </span>
            </button>
            {/* Faint, so it is life at the edge of the eye rather than
                something to watch during a call; and it can be turned off. */}
            {wave && (
              <Scope
                mode="wave"
                label="Both voices, live"
                className="h-8 min-w-0 flex-1 opacity-45"
              />
            )}
          </>
        )}

        {phase.kind === "saving" && (
          <p className="shrink-0 whitespace-nowrap font-mono text-xs text-ink-muted">
            <Prompt />
            saving…
          </p>
        )}

        {phase.kind === "saved" && (
          <p className="flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-xs text-ink-muted">
            <span className="text-phosphor">✓ saved</span>· writing notes…
            <button
              type="button"
              onClick={() => {
                void ipc.showMain(phase.notePath, false);
                void ipc.closeMini();
              }}
              // Its own font-mono, so the theme's letter case reaches it:
              // buttons reset text-transform, and "open" stayed lowercase in
              // an all-capitals line.
              className="rounded-xs px-1.5 font-mono text-phosphor trace-press hover:underline"
            >
              open
            </button>
          </p>
        )}
      </div>

      {/* The one round button, always in the same place. */}
      {phase.kind === "idle" && (
        <button
          type="button"
          onClick={() => void start()}
          aria-label="Start meeting"
          title="Start meeting (Enter)"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-error trace-press hover:brightness-110"
        >
          <span aria-hidden className="size-3.5 rounded-full bg-surface-0" />
        </button>
      )}
      {recording && <HoldToStop onStop={stop} onHint={setHint} />}

      {/* Secondary: there when the pointer is, faint when it is not, as
          Spotify's mini player keeps its corners clear. Focus shows them too.
          The same three in every state, so the round button never moves
          when Start becomes Stop. */}
      <span className="flex shrink-0 items-center opacity-40 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
        <IconButton
          label={wave ? "Hide the waveform" : "Show the waveform"}
          pressed={wave}
          onClick={() => setWave(!wave)}
        >
          <path d="M1 7h2l1.5-4 2 8 2-6 1.5 3H13" />
        </IconButton>
        <IconButton label="Back to TRACE" onClick={() => void ipc.showMain(null, false)}>
          <path d="M5 3h6v6M11 3 3 11" />
        </IconButton>
        <IconButton
          label="Close the mini window"
          title="Close — a meeting keeps recording"
          onClick={() => void ipc.closeMini()}
        >
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
        </IconButton>
      </span>
    </div>
  );
}

/** Whether the waveform shows. Remembered; on by default, and faint. */
function useWave(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(WAVE_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const set = (next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(WAVE_KEY, next ? "on" : "off");
    } catch {
      // Not worth surfacing — the choice simply does not persist.
    }
  };
  return [on, set];
}

/*
 * The grip sets the size for every icon here: each is drawn on the same
 * 14px square in the same 28px box, so the drag dots, the waveform switch,
 * back and close read as one set.
 */
const ICON = "flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-faint";

/** The six-dot grip every mini player uses; the only part that drags. */
function Grip() {
  return (
    <span data-tauri-drag-region title="Drag to move" aria-hidden className={`${ICON} cursor-grab`}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="currentColor"
        className="pointer-events-none"
        aria-hidden
      >
        {[4.5, 9.5].flatMap((x) =>
          [3, 7, 11].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />),
        )}
      </svg>
    </span>
  );
}

function IconButton({
  label,
  title,
  pressed,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      className={`${ICON} trace-press hover:bg-surface-2 hover:text-ink ${
        pressed === false ? "opacity-60" : ""
      }`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
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
