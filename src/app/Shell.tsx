import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { ConfirmProvider } from "../components/ui/Confirm";
import { Grain } from "../components/ui/Grain";
import { formatElapsed } from "../components/ui/terminal";
import { ActivityToast } from "../features/activity/ActivityToast";
import { useActivity } from "../features/activity/useActivity";
import { hasBackend, ipc } from "../lib/ipc";
import { type Page, Sidebar, SidebarHead } from "./Sidebar";
import { StatusBar } from "./StatusBar";

/**
 * Below this width the sidebar stops taking a column of its own.
 *
 * Measured on the shell, not the window, so the gallery's narrow preview
 * collapses exactly as a narrow window does. Granola folds its sidebar at
 * about 1000px; this sits just under TRACE's opening width so the app still
 * opens with it (docs/13-DESIGN-UPGRADES.md).
 */
const NARROW_PX = 960;

const HIDDEN_KEY = "trace.sidebar";

/**
 * The frame every screen sits in: sidebar, content, status bar.
 *
 * Its own component so the gallery renders the same one the app does. The
 * gallery used to keep a copy "reproduced exactly", which is the kind of
 * promise that stops being true the first time the shell changes.
 */
export function Shell({
  current,
  onNavigate,
  openNote = null,
  onOpenNote,
  children,
}: {
  /** The page to mark in the sidebar; null for a note, which is not a place. */
  current: Page | null;
  onNavigate: (page: Page) => void;
  /** The note on screen, so news about it is not repeated as a toast. */
  openNote?: string | null;
  onOpenNote?: (path: string) => void;
  children: ReactNode;
}) {
  // Read once here and handed down, so the status bar and the toast cannot
  // disagree about what is running.
  const jobs = useActivity();
  // Here rather than in the sidebar: when the sidebar is hidden, the strip
  // that replaces it has to keep showing a meeting is being recorded.
  const recording = useRecordingElapsed();

  const shell = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const narrow = useNarrow(shell);
  const [hidden, setHidden] = useHidden();
  const [overlay, setOverlay] = useState(false);
  const docked = !hidden && !narrow;

  // Widening the window past the breakpoint docks the sidebar, and an
  // overlay of something now on screen anyway would only be in the way.
  useEffect(() => {
    if (docked) setOverlay(false);
  }, [docked]);

  const closeOverlay = useCallback(() => {
    setOverlay(false);
    toggle.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && overlay) {
        closeOverlay();
        return;
      }
      if (!e.ctrlKey || e.key !== "\\") return;
      e.preventDefault();
      // Too narrow to dock: the shortcut opens and closes the overlay.
      if (narrow) setOverlay((o) => !o);
      else setHidden(!hidden);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, narrow, hidden, setHidden, closeOverlay]);

  const go = (page: Page) => {
    setOverlay(false);
    onNavigate(page);
  };

  return (
    <div ref={shell} className="trace-shell flex h-full flex-col bg-surface-0">
      {/* Inside the shell, so the dialog inherits whichever theme the shell
          is wearing — the app's, or a gallery preview's. */}
      <ConfirmProvider>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1">
            {docked && (
              <Sidebar
                current={current}
                onNavigate={go}
                recording={recording}
                onHide={() => setHidden(true)}
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              {!docked && (
                <SidebarStrip
                  toggle={toggle}
                  open={overlay}
                  // Hidden by hand on a wide window: the toggle brings it back
                  // for good. Too narrow to dock: it can only ever overlay.
                  onToggle={() => (narrow ? setOverlay((o) => !o) : setHidden(false))}
                  onHome={() => go("library")}
                  recording={recording}
                  onRecording={() => go("capture")}
                />
              )}
              {/* The canvas: the one part of the window the screen effects
                  are drawn on. The sidebar, its strip and the status bar are
                  the instrument's chrome and sit above the glass, untouched —
                  so the canvas is its own stacking context, and effects
                  inside it can never reach them. */}
              <main className="trace-canvas relative min-h-0 min-w-0 flex-1 bg-surface-0">
                {children}
                {/* The screen effects' layers (screen.css), in painting order.
                    Always rendered, drawn only when their effect is on, so
                    changing the screen changes attributes, not the tree. */}
                <span aria-hidden className="trace-fx trace-fx-dots" />
                <span aria-hidden className="trace-fx trace-fx-scanlines" />
                <Grain />
                <span aria-hidden className="trace-fx trace-fx-vignette" />
                <span aria-hidden className="trace-fx trace-fx-glass" />
                <span aria-hidden className="trace-fx trace-fx-roll" />
                <span aria-hidden className="trace-fx trace-fx-flicker" />
                {/* Always present, so a toast appearing inside it is announced:
                a live region created with its content often is not. Above the
                effects: news should be read, not seen through the glass. */}
                <div
                  aria-live="polite"
                  className="pointer-events-none absolute right-4 bottom-3 z-60 flex justify-end"
                >
                  <ActivityToast jobs={jobs} openNote={openNote} onOpenNote={onOpenNote} />
                </div>
              </main>
            </div>

            {!docked && overlay && (
              <>
                <button
                  type="button"
                  aria-label="Close sidebar"
                  tabIndex={-1}
                  onClick={closeOverlay}
                  className="trace-scrim absolute inset-0 z-40 cursor-default bg-black/50"
                />
                <div className="trace-slide-in absolute inset-y-0 left-0 z-40 flex shadow-(--elevation-overlay)">
                  <Sidebar
                    current={current}
                    onNavigate={go}
                    recording={recording}
                    onHide={closeOverlay}
                    overlay
                  />
                </div>
              </>
            )}
          </div>
          <StatusBar
            jobs={jobs}
            onManageModels={() => onNavigate("models")}
            onOpenNote={onOpenNote}
          />
        </div>
      </ConfirmProvider>
    </div>
  );
}

/**
 * The sidebar folded into a strip across the top.
 *
 * Its head is the sidebar's own, so the toggle and wordmark stay exactly
 * where they were. A strip rather than a floating button: one collided with the
 * capture screen's header, and a strip is also somewhere to keep the
 * recording timer. Leaving a recording must never feel like losing it, and
 * hiding the sidebar is a way of leaving it.
 */
function SidebarStrip({
  toggle,
  open,
  onToggle,
  onHome,
  recording,
  onRecording,
}: {
  toggle: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onToggle: () => void;
  onHome: () => void;
  recording: number | null;
  onRecording: () => void;
}) {
  return (
    // The border sits below the head row, not inside it, so the row is the
    // same height as the sidebar's and the toggle lands on the same pixel.
    <div className="flex shrink-0 items-center border-b border-line bg-surface-1 pr-2">
      <SidebarHead
        toggle={toggle}
        label="Show sidebar"
        title="Show sidebar (Ctrl+\)"
        expanded={open}
        onToggle={onToggle}
        onHome={onHome}
      />
      {recording !== null && (
        <button
          type="button"
          onClick={onRecording}
          className="ml-auto flex items-center gap-2 rounded-sm px-2 py-1 font-mono text-2xs text-ink-muted trace-press hover:text-ink"
        >
          <span aria-hidden className="inline-block size-1.5 rounded-full bg-error" />
          Recording
          <span className="tabular-nums text-ink-faint">{formatElapsed(recording)}</span>
        </button>
      )}
    </div>
  );
}

/** Whether the element is narrower than the breakpoint. */
function useNarrow(target: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const el = target.current;
    // Absent in tests. "Not narrow" is the layout every test expects.
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      // Zero means not laid out yet, not a window with no width.
      if (width > 0) setNarrow(width < NARROW_PX);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  return narrow;
}

/** Whether the user has hidden the sidebar by hand. Survives a restart. */
function useHidden(): [boolean, (hidden: boolean) => void] {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN_KEY) === "hidden";
    } catch {
      return false;
    }
  });

  const set = useCallback((next: boolean) => {
    setHidden(next);
    try {
      if (next) localStorage.setItem(HIDDEN_KEY, "hidden");
      else localStorage.removeItem(HIDDEN_KEY);
    } catch {
      // Not worth surfacing — the choice simply does not persist.
    }
  }, []);

  return [hidden, set];
}

/**
 * Elapsed time of the meeting being recorded, or null when there is none.
 *
 * Polled, because the shell has to know about a recording started on a
 * screen it cannot see. Once a second is what the timer displays anyway.
 */
function useRecordingElapsed(): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!hasBackend()) return;
    let cancelled = false;
    const poll = () => {
      void ipc
        .captureStatus()
        .then((s) => {
          if (!cancelled) setElapsed(s ? s.elapsedMs : null);
        })
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return elapsed;
}
