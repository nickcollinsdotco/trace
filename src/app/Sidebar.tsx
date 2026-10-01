import { type RefObject, useEffect, useRef } from "react";
import { formatElapsed, SystemLabel } from "../components/ui/terminal";
import { ipc } from "../lib/ipc";
import { Wordmark } from "./Wordmark";

export type Page = "library" | "capture" | "models" | "appearance" | "settings" | "about";

const PRIMARY: Array<{ page: Page; label: string }> = [
  { page: "library", label: "Meetings" },
  { page: "capture", label: "Record" },
];

const SECONDARY: Array<{ page: Page; label: string }> = [
  { page: "models", label: "Models" },
  { page: "appearance", label: "Appearance" },
  { page: "settings", label: "Settings" },
  { page: "about", label: "About" },
];

/**
 * The app's places, always visible.
 *
 * A meeting keeps recording when you leave its screen — capture is owned by
 * the backend, not by a component — so "Record" turns into a live timer while
 * one is running. Leaving a recording must never feel like losing it.
 *
 * It can be hidden (Shell.tsx): by hand at any width, and automatically in a
 * narrow window, where it comes back as an overlay rather than a column.
 */
export function Sidebar({
  current,
  onNavigate,
  recording,
  onHide,
  overlay = false,
}: {
  current: Page | null;
  onNavigate: (page: Page) => void;
  /** Elapsed milliseconds of the meeting being recorded, or null. */
  recording: number | null;
  onHide: () => void;
  /** Shown over the content rather than beside it. */
  overlay?: boolean;
}) {
  const hide = useRef<HTMLButtonElement>(null);

  // Opened as an overlay from the keyboard, focus has to land inside it, or
  // the next Tab walks the page hidden underneath.
  useEffect(() => {
    if (overlay) hide.current?.focus();
  }, [overlay]);

  return (
    <aside
      aria-label="Sidebar"
      className="flex w-(--sidebar-width) shrink-0 flex-col border-r border-line bg-surface-1"
    >
      <SidebarHead
        toggle={hide}
        label={overlay ? "Close sidebar" : "Hide sidebar"}
        title={overlay ? "Close sidebar (Esc)" : "Hide sidebar (Ctrl+\\)"}
        expanded
        onToggle={onHide}
        onHome={() => onNavigate("library")}
      />

      <nav aria-label="App" className="flex flex-col gap-4 px-3 pt-4 pb-4">
        <NavGroup>
          {PRIMARY.map(({ page, label }) => (
            <NavItem
              key={page}
              label={page === "capture" && recording !== null ? "Recording" : label}
              current={current === page}
              onSelect={() => onNavigate(page)}
              live={page === "capture" && recording !== null}
              trailing={
                page === "capture" && recording !== null ? formatElapsed(recording) : undefined
              }
            />
          ))}
        </NavGroup>
        <NavGroup label="System">
          {SECONDARY.map(({ page, label }) => (
            <NavItem
              key={page}
              label={label}
              current={current === page}
              onSelect={() => onNavigate(page)}
            />
          ))}
        </NavGroup>
      </nav>

      {/* At the foot, out of the way of the places above. Opens the mini
          window whatever is happening: idle, it asks for a name; recording,
          it is the bar. */}
      <button
        type="button"
        onClick={() =>
          void ipc
            .captureStatus()
            .then((s) => ipc.openMini(s === null))
            .catch(() => {})
        }
        title="Mini window — floats over everything (Ctrl+Alt+R)"
        className="mx-3 mt-auto mb-3 flex items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-2xs text-ink-faint trace-press hover:bg-surface-2 hover:text-ink"
      >
        <span aria-hidden>◳</span>
        Mini window
      </button>
    </aside>
  );
}

function NavGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      {label && (
        <span className="px-2 pb-1">
          <SystemLabel>{label}</SystemLabel>
        </span>
      )}
      {children}
    </div>
  );
}

function NavItem({
  label,
  current,
  onSelect,
  live,
  trailing,
}: {
  label: string;
  current: boolean;
  onSelect: () => void;
  live?: boolean;
  trailing?: string | undefined;
}) {
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      onClick={onSelect}
      // Sentence case at the UI size, not 11px caps: these are the most-used
      // controls in the app, and caps at that size were the hardest thing in
      // it to read. The group labels above keep the system voice.
      className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-sm trace-press ${
        current
          ? "bg-phosphor-dim text-phosphor"
          : "text-ink-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {/* The prompt is terminal-only; the live dot is state, so it stays in
          every family. The slot collapses when it holds neither. */}
      <span aria-hidden className="trace-marker w-2 shrink-0">
        {live ? (
          <span className="inline-block size-1.5 rounded-full bg-error" />
        ) : current ? (
          <span className="trace-glyph">&gt;</span>
        ) : null}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {trailing && <span className="tabular-nums text-ink-faint">{trailing}</span>}
    </button>
  );
}

/**
 * The toggle and the wordmark, in the one place they always sit.
 *
 * Shared by the sidebar and the strip it folds into, so hiding or showing
 * the sidebar never moves the button you just pressed — Granola's rule. The
 * two only line up because they are the same row: same height, same padding,
 * toggle first.
 */
export function SidebarHead({
  toggle,
  label,
  title,
  expanded,
  onToggle,
  onHome,
}: {
  toggle?: RefObject<HTMLButtonElement | null>;
  label: string;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  onHome: () => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 px-2">
      <button
        ref={toggle}
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-expanded={expanded}
        title={title}
        className="flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-faint trace-press hover:bg-surface-2 hover:text-ink"
      >
        <PanelIcon />
      </button>
      <button
        type="button"
        onClick={onHome}
        className="rounded-xs px-1.5 transition-opacity duration-120 hover:opacity-80"
        aria-label="TRACE — back to meetings"
        // Counted by Fun mode's wordmark secret (features/fun/Eggs.tsx).
        data-wordmark
      >
        <Wordmark />
      </button>
    </div>
  );
}

/**
 * A panel with its sidebar ruled off: the hide and show control.
 *
 * Drawn rather than a glyph, because no box-drawing character reads as
 * "sidebar", and the mono fonts in use disagree about the ones that come
 * close.
 */
export function PanelIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1" />
      <path d="M6.25 2.75v10.5" />
    </svg>
  );
}
