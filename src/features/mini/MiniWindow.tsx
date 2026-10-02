import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { SwitchLook } from "../../components/ui/Switch";
import { formatElapsed, Prompt } from "../../components/ui/terminal";
import { type CaptureStatus, hasBackend, ipc, onCaptureChanged } from "../../lib/ipc";
import { shortMic, shortModel } from "../../lib/names";
import { Scope } from "../scope/Scope";
import { shortcutLabel, useMiniShortcut } from "./shortcut";

/** How long Stop must be held (docs/13 Q26). Long enough to be deliberate. */
export const HOLD_MS = 600;
/** How long "saved" stays before the window closes itself. */
const SAVED_MS = 4_000;
const POLL_MS = 500;
/** The bar's usual width, which the window returns to once content fits. */
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
 * Music's, Recordly's: one round button carries the bar, and everything
 * minor lives in an options menu rather than a row of its own buttons.
 *
 * One bar, whatever the state, so nothing jumps when a meeting starts: the
 * name field sits where the meeting's name will be, and the round red Start
 * sits exactly where Stop will. The details row joins the bar's frame above
 * it; the menu floats free over it, on nothing — the window is transparent,
 * and only the bar and the menu are drawn. The window grows upwards to hold
 * them, so the bar never moves on the screen. Stop has to be held — the bar sits beside a call's own
 * controls, where one stray click would end a meeting that cannot be
 * resumed. Closing it only closes it; the meeting carries on.
 *
 * Only the ⠿ grip drags the window, so a click is never mistaken for a drag.
 */
export function MiniWindow({
  initial,
  initialMenu = false,
  initialDetails,
  offer: offered = typeof location !== "undefined" && location.hash.includes("offer"),
}: {
  initial?: MiniPhase;
  /** Opened by itself the first time TRACE was minimised in a meeting. */
  offer?: boolean;
  /** Open on the options menu — the gallery's scenario for it. */
  initialMenu?: boolean;
  /** Override the remembered choice — the gallery's scenario for it. */
  initialDetails?: boolean;
} = {}) {
  const [phase, setPhase] = useState<MiniPhase>(initial ?? { kind: "idle" });
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [menu, setMenu] = useState(initialMenu);
  const [offer, setOffer] = useState(offered);
  const [wave, setWave] = usePref("trace.mini.wave", true);
  const [details, setDetails] = usePref("trace.mini.details", false, initialDetails);
  const [hidden, setHidden] = usePref("trace.mini.shares-hidden", true);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useInputKind();

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

  // Screen shares: hidden unless asked for (docs/13 Q18). The window opens
  // hidden; this brings it in line with the remembered choice.
  useEffect(() => {
    if (hasBackend()) void ipc.protectMini(hidden).catch(() => {});
  }, [hidden]);

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

  /*
   * The window is sized to what it shows. Wider when a theme in capitals or
   * a wide typeface would wrap a line inside the 56px bar; taller for the
   * menu and the details row. Rust grows it up and to the left, keeping the
   * bar where it is. Measured after anything that changes the stack, once
   * the fonts are in, and when the theme changes in the other window.
   */
  const root = useRef<HTMLDivElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const kind = phase.kind;
  // biome-ignore lint/correctness/useExhaustiveDependencies: menu and details change the stack's height, so they re-measure it
  useLayoutEffect(() => {
    if (initial || !hasBackend()) return;
    const measure = () => {
      const el = root.current;
      const content = stack.current;
      if (!el || !content) return;
      // The card clips its own overflow for its rounded corners, so the
      // details row's full width is read from the card, not the window.
      const needed = Math.max(el.scrollWidth, card.current?.scrollWidth ?? 0);
      const overflowing = needed > el.clientWidth + 1;
      // The bar's middle stretches, so outside the saved states it always
      // fits the usual width; only a real overflow widens it.
      const width = overflowing
        ? needed + 4
        : kind === "idle" || kind === "recording"
          ? BAR_WIDTH
          : el.clientWidth;
      void ipc.fitMini(width, content.getBoundingClientRect().height).catch(() => {});
    };
    measure();
    void document.fonts?.ready.then(measure);
    window.addEventListener("storage", measure);
    return () => window.removeEventListener("storage", measure);
  }, [kind, initial, menu, details, offer]);

  return (
    <div
      ref={root}
      // The empty, see-through part of the window: a click on it is a click
      // away from the menu, as it would be anywhere else.
      onPointerDown={(e) => {
        if (menu && (e.target === root.current || e.target === stack.current)) setMenu(false);
      }}
      className="trace-mini group flex h-full flex-col justify-end overflow-hidden text-ink select-none"
    >
      <div ref={stack} className="flex shrink-0 flex-col gap-1.5">
        {menu && (
          <OptionsMenu
            onClose={() => setMenu(false)}
            wave={wave}
            onWave={setWave}
            details={details}
            onDetails={setDetails}
            hidden={hidden}
            onHidden={setHidden}
          />
        )}

        <div
          ref={card}
          className="flex flex-col overflow-hidden rounded-md border border-line-strong bg-surface-1"
        >
          {offer && <Offer onDone={() => setOffer(false)} />}

          {details && <Details status={recording ? phase.status : null} />}

          <div className="flex h-14 shrink-0 items-center gap-2 pr-1.5 pl-1">
            <Grip />

            <div className="relative flex min-w-0 flex-1 items-center gap-3 self-stretch">
              {/* The scope at rest behind the name: on, with nothing yet to
                draw, so a meeting starting is seen as the signal arriving. */}
              {phase.kind === "idle" && wave && (
                <Scope
                  idle
                  mode="wave"
                  label="Waveform, waiting for a meeting"
                  className="pointer-events-none absolute inset-x-0 inset-y-3 h-8 w-full opacity-30"
                />
              )}
              {phase.kind === "idle" && (
                <form
                  className="relative min-w-0 flex-1"
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
                      // A failure is said where the name goes, so the bar keeps
                      // its one row and its shape.
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
                    {/* A click on Stop is answered here, under the name, where
                      the eye already is — not over the waveform. */}
                    <span
                      className={`font-mono text-2xs tabular-nums ${hint ? "text-error" : "text-ink-muted"}`}
                    >
                      {hint ? "hold to stop" : formatElapsed(phase.status.elapsedMs)}
                    </span>
                  </button>
                  {/* Faint, so it is life at the edge of the eye rather than
                    something to watch during a call; off in the menu. */}
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
                    // buttons reset text-transform, and "open" stayed lowercase
                    // in an all-capitals line.
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

            {/* Options, back and close: there when the pointer is, faint when
              it is not, as Spotify keeps its corners clear — and held at full
              strength while the menu is open. The same three in every state,
              so the round button never moves when Start becomes Stop. */}
            <span
              className={`flex shrink-0 items-center transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 ${
                menu ? "opacity-100" : "opacity-40"
              }`}
            >
              <IconButton
                label="Options"
                expanded={menu}
                active={menu}
                onClick={() => setMenu(!menu)}
              >
                <circle cx="7" cy="3" r="1.1" fill="currentColor" stroke="none" />
                <circle cx="7" cy="7" r="1.1" fill="currentColor" stroke="none" />
                <circle cx="7" cy="11" r="1.1" fill="currentColor" stroke="none" />
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
        </div>
      </div>
    </div>
  );
}

/**
 * The one-time offer (docs/13 Q16): asked inline, on the window it is about,
 * the first time TRACE is minimised during a meeting — never as a dialog in
 * the way of the call. Yes means "when I switch away", which is how people
 * actually get to a call; either answer is final, and Settings can change it.
 */
function Offer({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2 text-xs whitespace-nowrap">
      <span className="text-ink">Open this whenever you switch away from TRACE?</span>
      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            void ipc.setMiniAuto("switch_away").catch(() => {});
            onDone();
          }}
          className="rounded-sm bg-phosphor-dim px-2.5 py-1 font-mono text-2xs text-phosphor trace-press hover:bg-phosphor hover:text-surface-0"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-sm px-2.5 py-1 font-mono text-2xs text-ink-faint trace-press hover:text-ink"
        >
          Not now
        </button>
      </span>
    </div>
  );
}

/**
 * The minor controls, in one menu above the bar, as Recordly keeps its own:
 * switches that are set once and left, not reached for during a call.
 */
function OptionsMenu({
  onClose,
  wave,
  onWave,
  details,
  onDetails,
  hidden,
  onHidden,
}: {
  onClose: () => void;
  wave: boolean;
  onWave: (on: boolean) => void;
  details: boolean;
  onDetails: (on: boolean) => void;
  hidden: boolean;
  onHidden: (on: boolean) => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  const shortcut = useMiniShortcut();
  useEffect(() => {
    first.current?.focus();
  }, []);

  return (
    <div className="flex justify-end">
      <div
        role="menu"
        aria-label="Mini window options"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        // As wide as its longest line, so a wide typeface widens the menu —
        // and the window with it — rather than wrapping a line. No shadow:
        // the window ends at the menu's edge and would cut it off square.
        className="w-max min-w-64 rounded-md border border-line-strong bg-surface-2 py-1 whitespace-nowrap"
      >
        <MenuSwitch refTo={first} checked={wave} onChange={onWave}>
          Waveform
        </MenuSwitch>
        <MenuSwitch checked={details} onChange={onDetails}>
          Details — microphone and model
        </MenuSwitch>
        <MenuSwitch checked={hidden} onChange={onHidden}>
          Hidden from screen shares
        </MenuSwitch>
        <div aria-hidden className="my-1 border-t border-line" />
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            void ipc.showMain(null, false);
          }}
          className="flex w-full items-center px-3 py-1.5 text-left text-xs text-ink-muted trace-press hover:bg-surface-3 hover:text-ink"
        >
          Open TRACE
        </button>
        {shortcut && (
          <p className="px-3 pt-1 pb-1.5 font-mono text-2xs text-ink-faint">
            {shortcutLabel(shortcut)} opens this from anywhere
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A setting in the menu: the label, and a switch that says whether it is on.
 * A switch rather than a tick, because each is a state left on or off, not
 * an action taken — and a row of ticks reads as a list of choices.
 */
function MenuSwitch({
  checked,
  onChange,
  refTo,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  refTo?: React.RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  return (
    <button
      ref={refTo}
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-6 px-3 py-2 text-left text-xs text-ink-muted trace-press hover:bg-surface-3 hover:text-ink"
    >
      {children}
      <SwitchLook on={checked} />
    </button>
  );
}

/**
 * The extended view: what the meeting is listening with and transcribing
 * with, as Recordly's bar names the screen it records. During a meeting it
 * reads the meeting's own; idle, the defaults a meeting would start with.
 */
function Details({ status }: { status: CaptureStatus | null }) {
  const [defaults, setDefaults] = useState<{ mic: string | null; model: string | null }>({
    mic: null,
    model: null,
  });

  useEffect(() => {
    if (status || !hasBackend()) return;
    void Promise.all([ipc.getSettings(), ipc.speechModels()])
      .then(([settings, models]) =>
        setDefaults({
          mic: settings.defaultMic ?? null,
          model: models.find((m) => m.active)?.name ?? null,
        }),
      )
      .catch(() => {});
  }, [status]);

  const mic = (status ? status.mic : defaults.mic) ?? "system default";
  const model = status ? status.speechModel : (defaults.model ?? "no speech model");

  // Sized to its text: the window widens for it (to its limit) rather than
  // truncating the very words the row is there to show. Names are cut to
  // what tells them apart (names.ts); the full ones are in the tooltip.
  return (
    <div
      title={`${mic} · ${model}`}
      className="flex h-8 shrink-0 items-center gap-4 border-b border-line px-3 font-mono text-2xs text-ink-faint whitespace-nowrap"
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="trace-caps-label text-ink-muted">mic</span>
        <span className="max-w-60 truncate text-ink">{shortMic(mic)}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="trace-caps-label text-ink-muted">model</span>
        <span className="max-w-40 truncate text-ink">{shortModel(model)}</span>
      </span>
      {status && (
        <span className="ml-auto shrink-0 tabular-nums">{status.segmentCount} segments</span>
      )}
    </div>
  );
}

/**
 * Mark the page with how it was last used, so focus rings show only for the
 * keyboard. A drag by the grip hands focus back to the window when it ends,
 * and the browser then rings whatever button last had focus — as if Tab had
 * been pressed — though nobody touched a key.
 */
function useInputKind() {
  useEffect(() => {
    const root = document.documentElement;
    const pointer = () => {
      root.dataset.input = "pointer";
    };
    const keyboard = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Tab" || e.key.startsWith("Arrow") || e.key === "Escape") {
        root.dataset.input = "keyboard";
      }
    };
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("keydown", keyboard, true);
    return () => {
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("keydown", keyboard, true);
    };
  }, []);
}

/** A switch remembered between openings; an override wins for the gallery. */
function usePref(
  key: string,
  fallback: boolean,
  override?: boolean,
): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    if (override !== undefined) return override;
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? fallback : saved === "on";
    } catch {
      return fallback;
    }
  });
  const set = (next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(key, next ? "on" : "off");
    } catch {
      // Not worth surfacing — the choice simply does not persist.
    }
  };
  return [on, set];
}

/*
 * The grip sets the size for every icon here: each is drawn on the same
 * 14px square in the same 28px box, so the drag dots, options, back and
 * close read as one set.
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
  expanded,
  active = false,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  expanded?: boolean;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      title={title ?? label}
      className={`${ICON} trace-press hover:bg-surface-2 hover:text-ink ${
        active ? "bg-surface-2 text-ink" : ""
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
