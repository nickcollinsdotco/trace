import { useEffect, useState } from "react";
import { formatElapsed } from "../components/ui/terminal";
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
    <aside className="flex w-44 shrink-0 flex-col gap-6 border-r border-line bg-surface-1 px-3 py-4">
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
        <NavGroup>
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

function NavGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-0.5">{children}</div>;
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
      className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-2xs uppercase tracking-system trace-press ${
        current
          ? "bg-phosphor-dim text-phosphor"
          : "text-ink-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      <span aria-hidden className="w-2 shrink-0">
        {live ? (
          <span className="inline-block size-1.5 rounded-full bg-error" />
        ) : current ? (
          ">"
        ) : (
          ""
        )}
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
