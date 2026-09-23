import type { ReactNode } from "react";
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
  children,
}: {
  /** The page to mark in the sidebar; null for a note, which is not a place. */
  current: Page | null;
  onNavigate: (page: Page) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-surface-0">
      <div className="flex min-h-0 flex-1">
        <Sidebar current={current} onNavigate={onNavigate} />
        <main className="min-h-0 min-w-0 flex-1">{children}</main>
      </div>
      <StatusBar onManageModels={() => onNavigate("models")} />
    </div>
  );
}
