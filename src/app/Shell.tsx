import type { ReactNode } from "react";
import { Menu, type MenuItem } from "./Menu";
import { ModelGate } from "./ModelGate";
import { StatusBar } from "./StatusBar";
import { Wordmark } from "./Wordmark";

/**
 * The frame every screen sits in: header, content, status bar.
 *
 * Its own component so the gallery renders the same one the app does. The
 * gallery used to keep a copy "reproduced exactly", which is the kind of
 * promise that stops being true the first time the shell changes.
 */
export function Shell({
  onHome,
  menu,
  onOpenDiagnostics,
  children,
}: {
  onHome: () => void;
  menu: MenuItem[];
  onOpenDiagnostics: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-surface-0">
      <header className="flex shrink-0 items-center gap-4 border-b border-line px-5 py-3">
        <button
          type="button"
          onClick={onHome}
          className="rounded-xs transition-opacity duration-120 hover:opacity-80"
          aria-label="TRACE — back to meetings"
        >
          <Wordmark />
        </button>
        <span aria-hidden className="trace-rule" />
        <ModelGate />
        <Menu items={menu} />
      </header>

      <main className="min-h-0 flex-1">{children}</main>

      <StatusBar onOpenDiagnostics={onOpenDiagnostics} />
    </div>
  );
}
