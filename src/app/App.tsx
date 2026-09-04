import { useState } from "react";
import { CaptureScreen } from "../features/capture/CaptureScreen";
import { LibraryScreen } from "../features/library/LibraryScreen";
import { Wordmark } from "./Wordmark";

/**
 * Route state. Deliberately a union rather than a router library — TRACE has
 * three screens and adding react-router here would be exactly the premature
 * infrastructure docs/08-CLAUDE-AUDIT-PROMPT.md warns against.
 */
type Route = { name: "library" } | { name: "capture"; meetingId: string };

export function App() {
  const [route, setRoute] = useState<Route>({ name: "library" });

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <header className="flex shrink-0 items-center gap-4 border-b border-line px-5 py-3">
        <button
          type="button"
          onClick={() => setRoute({ name: "library" })}
          className="rounded-xs transition-opacity duration-120 hover:opacity-80"
          aria-label="TRACE — back to meetings"
        >
          <Wordmark />
        </button>
      </header>

      <main className="min-h-0 flex-1">
        {route.name === "library" ? (
          <LibraryScreen onOpenCapture={(meetingId) => setRoute({ name: "capture", meetingId })} />
        ) : (
          <CaptureScreen
            meetingId={route.meetingId}
            onFinish={() => setRoute({ name: "library" })}
          />
        )}
      </main>
    </div>
  );
}
