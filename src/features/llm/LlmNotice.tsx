import { useState } from "react";
import { Prompt, SystemLabel } from "../../components/ui/terminal";
import { ipc, type LlmStatus } from "../../lib/ipc";

/**
 * Says, before it matters, that notes cannot be written.
 *
 * Recording and transcription never depend on Ollama, so the notice says that
 * first: the user's worry on seeing a warning is whether their meeting is at
 * risk, and it is not. Only the summary and action items are.
 *
 * Renders nothing while the status is unknown or ready.
 */
export function LlmNotice({
  status,
  onRecheck,
  context,
}: {
  status: LlmStatus | null;
  onRecheck: () => void;
  /**
   * Where it is shown. In the library the risk is the next meeting ending
   * with Ollama closed; on a note the meeting is over and the question is
   * only how to generate its summary now.
   */
  context: "library" | "note" | "models";
}) {
  const [starting, setStarting] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  if (status === null || status.state === "ready") return null;

  async function open() {
    setStarting(true);
    setLaunchError(null);
    try {
      await ipc.startOllama();
      // Ollama takes a few seconds to start listening. The status hook is
      // already polling, so the notice clears itself; this only keeps the
      // button honest in the meantime.
      window.setTimeout(() => setStarting(false), 8_000);
    } catch (e) {
      setLaunchError(String(e));
      setStarting(false);
    }
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-md border border-warn/40 bg-warn-dim trace-panel p-4"
    >
      <div className="flex items-baseline gap-2">
        <SystemLabel tone="muted">Notes offline</SystemLabel>
        <span aria-hidden className="trace-rule" />
      </div>

      {status.state === "not_running" ? (
        <>
          <p className="trace-title text-base text-ink">Ollama isn’t running</p>
          <p className="text-xs text-ink-muted">
            {context === "library"
              ? "Meetings are still recorded and transcribed. The summary and action items are written when a meeting ends, and need Ollama open at that moment."
              : context === "models"
                ? "TRACE writes summaries with models run by Ollama. Open it to see the models you have and download others."
                : "The transcript is safe. Open Ollama to generate the summary and action items."}
          </p>
        </>
      ) : (
        <>
          <p className="trace-title text-base text-ink">Ollama has no model</p>
          <p className="text-xs text-ink-muted">
            {context === "library"
              ? "Meetings are still recorded and transcribed. "
              : context === "note"
                ? "The transcript is safe. "
                : ""}
            To write summaries and action items, run this in a terminal, then check again:
          </p>
          <code
            data-selectable
            className="w-fit rounded-xs bg-surface-2 px-2 py-1 font-mono text-2xs text-ink"
          >
            ollama pull {status.suggested}
          </code>
        </>
      )}

      {launchError && (
        <p className="font-mono text-2xs text-error">
          <Prompt />
          {launchError}
        </p>
      )}

      <div className="flex items-center gap-3">
        {status.state === "not_running" && (
          <button
            type="button"
            onClick={open}
            disabled={starting}
            className="rounded-sm border border-phosphor px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-phosphor trace-press hover:bg-phosphor hover:text-surface-0 disabled:opacity-50"
          >
            {starting ? "Starting…" : "Open Ollama"}
          </button>
        )}
        <button
          type="button"
          onClick={onRecheck}
          className="font-mono text-2xs uppercase tracking-system text-ink-faint trace-press hover:text-ink"
        >
          Check again
        </button>
      </div>
    </div>
  );
}
