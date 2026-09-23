import { useCallback, useEffect, useState } from "react";
import { hasBackend, ipc, type LlmStatus } from "../../lib/ipc";

/** How often to look again while Ollama is not usable. */
const POLL_MS = 5_000;

/**
 * Whether notes can be generated, kept current without the user asking.
 *
 * Ollama is a separate app the user can quit at any time, and did — which is
 * how summaries went missing with nothing on screen to say why. So this looks
 * on mount, again whenever the window regains focus (the moment someone comes
 * back from opening Ollama), and every few seconds while it is not ready so
 * the notice clears itself once they have fixed it. Once ready it stops
 * polling: a probe every few seconds for the life of the app would be waste.
 *
 * `null` until the first answer, so nothing flashes a warning on launch.
 */
export function useLlmStatus(): { status: LlmStatus | null; recheck: () => void } {
  const [status, setStatus] = useState<LlmStatus | null>(null);

  const recheck = useCallback(() => {
    if (!hasBackend()) return;
    void ipc
      .llmStatus()
      .then(setStatus)
      .catch(() => setStatus({ state: "not_running" }));
  }, []);

  useEffect(() => {
    recheck();
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [recheck]);

  const ready = status?.state === "ready";
  useEffect(() => {
    if (status === null || ready) return;
    const id = window.setInterval(recheck, POLL_MS);
    return () => window.clearInterval(id);
  }, [status, ready, recheck]);

  return { status, recheck };
}
