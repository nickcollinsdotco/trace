import type { ReactNode } from "react";
import { ActivityToast } from "../features/activity/ActivityToast";
import { useActivity } from "../features/activity/useActivity";
import { type Page, Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";

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

  return (
    <div className="trace-shell flex h-full flex-col bg-surface-0">
      {/* CRT mode's hardware. Always rendered, shown only under
          `data-screen="crt"`, so the switch is one attribute and not a
          remount of everything inside the screen. */}
      <span aria-hidden className="trace-bezel trace-screw" data-corner="tl" />
      <span aria-hidden className="trace-bezel trace-screw" data-corner="tr" />
      <span aria-hidden className="trace-bezel trace-screw" data-corner="bl" />
      <span aria-hidden className="trace-bezel trace-screw" data-corner="br" />
      <span aria-hidden className="trace-bezel trace-leds" />
      <span aria-hidden className="trace-bezel trace-vent" />

      <div className="trace-screen flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <Sidebar current={current} onNavigate={onNavigate} />
          <main className="relative min-h-0 min-w-0 flex-1">
            {children}
            {/* Always present, so a toast appearing inside it is announced:
              a live region created with its content often is not. */}
            <div
              aria-live="polite"
              className="pointer-events-none absolute right-4 bottom-3 z-20 flex justify-end"
            >
              <ActivityToast jobs={jobs} openNote={openNote} onOpenNote={onOpenNote} />
            </div>
          </main>
        </div>
        <StatusBar
          jobs={jobs}
          onManageModels={() => onNavigate("models")}
          onOpenNote={onOpenNote}
        />
      </div>
    </div>
  );
}
