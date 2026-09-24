import { useEffect, useState } from "react";
import { formatElapsed, SystemLabel } from "../components/ui/terminal";
import { hasBackend, ipc } from "../lib/ipc";
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
 */
export function Sidebar({
  current,
  onNavigate,
}: {
  current: Page | null;
  onNavigate: (page: Page) => void;
}) {
  const recording = useRecordingElapsed();

  return (
    // Width from one variable, so the collapsible version planned for this
    // sidebar changes a value rather than every class that assumes a size.
    <aside className="flex w-(--sidebar-width) shrink-0 flex-col gap-6 border-r border-line bg-surface-1 px-3 py-4">
      <button
        type="button"
        onClick={() => onNavigate("library")}
        className="self-start rounded-xs px-2 transition-opacity duration-120 hover:opacity-80"
        aria-label="TRACE — back to meetings"
      >
        <Wordmark />
      </button>

      <nav aria-label="App" className="flex flex-col gap-4">
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
 * Elapsed time of the meeting being recorded, or null when there is none.
 *
 * Polled, because the sidebar has to know about a recording started on a
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
