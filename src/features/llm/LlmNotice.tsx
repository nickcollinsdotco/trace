import { useEffect, useState } from "react";
import { Prompt, SystemLabel } from "../../components/ui/terminal";
import { formatBytes } from "../../lib/format";
import { hasBackend, ipc, type LlmStatus, onSummaryPull } from "../../lib/ipc";

/** Where the library remembers that someone chose to go without summaries. */
const DISMISSED_KEY = "trace.llm.setupDismissed";

/**
 * Says, before it matters, that notes cannot be written — and what to do.
 *
 * Recording and transcription never depend on Ollama, so the notice says that
 * first: the user's worry on seeing it is whether their meeting is at risk,
 * and it is not. Only the summary and action items are.
 *
 * Each state carries its own fix, done from here where TRACE can do it: a
 * link to Ollama's download page, opening Ollama, or downloading a model.
 * The last used to be a terminal command to copy, which is a lot to ask of
 * someone who has just installed their first local AI app.
 *
 * Missing Ollama is a setup step, not a fault, so it is drawn calmly and can
 * be put away in the library by someone who only wants transcripts. A closed
 * or empty Ollama is a fault — it was there and is not now — and stays amber.
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
  const [failure, setFailure] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(loadDismissed);
  const download = usePull(
    status?.state === "no_model" ? status.suggested : null,
    onRecheck,
    setFailure,
  );

  if (status === null || status.state === "ready") return null;
  const setup = status.state === "not_installed";
  if (setup && context === "library" && dismissed) return null;

  async function open() {
    setStarting(true);
    setFailure(null);
    try {
      await ipc.startOllama();
      // Ollama takes a few seconds to start listening. The status hook is
      // already polling, so the notice clears itself; this only keeps the
      // button honest in the meantime.
      window.setTimeout(() => setStarting(false), 8_000);
    } catch (e) {
      setFailure(String(e));
      setStarting(false);
    }
  }

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Not worth surfacing: it simply comes back next launch.
    }
  };

  // What is safe, said first, in the words of where the reader is.
  const safe =
    context === "library"
      ? "Meetings are still recorded and transcribed. "
      : context === "note"
        ? "The transcript is safe. "
        : "";

  return (
    <div
      role="status"
      className={`flex flex-col gap-3 rounded-md border trace-panel p-4 ${
        setup ? "border-line-strong bg-surface-1" : "border-warn/40 bg-warn-dim"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <SystemLabel tone="muted">{setup ? "Setup" : "Notes offline"}</SystemLabel>
        <span aria-hidden className="trace-rule" />
      </div>

      {status.state === "not_installed" && (
        <>
          <p className="trace-title text-base text-ink">Summaries need Ollama</p>
          <p className="text-xs text-ink-muted">
            {safe}
            TRACE writes the summary and action items with Ollama, a free app that runs AI models on
            this computer — so the meeting never leaves it. Install Ollama, open it once, and TRACE
            will find it by itself.
          </p>
        </>
      )}

      {status.state === "not_running" && (
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
      )}

      {status.state === "no_model" && (
        <>
          <p className="trace-title text-base text-ink">Ollama has no model yet</p>
          <p className="text-xs text-ink-muted">
            {safe}
            Summaries need a model to write them.{" "}
            <span className="font-mono">{status.suggested}</span> runs on most machines
            {download.bytes ? ` and is about ${formatBytes(download.bytes)} to download, once` : ""}
            . Larger ones are on the Models page.
          </p>
        </>
      )}

      {failure && (
        <p className="font-mono text-2xs text-error">
          <Prompt />
          {failure}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {status.state === "not_installed" && (
          <button
            type="button"
            onClick={() => void ipc.openLink("ollama").catch((e) => setFailure(String(e)))}
            className="trace-btn trace-btn-primary trace-press"
          >
            Get Ollama <span aria-hidden>↗</span>
          </button>
        )}
        {status.state === "no_model" &&
          (download.percent === null ? (
            <button
              type="button"
              onClick={() => {
                setFailure(null);
                download.pull();
              }}
              className="trace-btn trace-btn-primary trace-press"
            >
              Download {status.suggested}
            </button>
          ) : (
            <span className="flex w-56 items-center gap-2" role="status" aria-label="Downloading">
              <span
                className="trace-fill h-2 flex-1"
                style={{ "--fill": download.percent / 100 } as React.CSSProperties}
              />
              <span className="w-9 text-right font-mono text-2xs tabular-nums text-ink-muted">
                {download.percent}%
              </span>
            </span>
          ))}
        {status.state === "not_running" && (
          <button
            type="button"
            onClick={open}
            disabled={starting}
            className="trace-btn trace-btn-primary trace-press disabled:opacity-50"
          >
            {starting ? "Starting…" : "Open Ollama"}
          </button>
        )}
        <button type="button" onClick={onRecheck} className="trace-btn trace-btn-quiet trace-press">
          Check again
        </button>
        {setup && context === "library" && (
          <button
            type="button"
            onClick={dismiss}
            title="Hide this. The status bar still says summaries are off."
            className="trace-btn trace-btn-quiet trace-press ml-auto"
          >
            Transcripts only
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Downloading the suggested model from the notice, with its size said
 * first, since it is several gigabytes.
 */
function usePull(suggested: string | null, onDone: () => void, onFailure: (m: string) => void) {
  const [bytes, setBytes] = useState<number | null>(null);
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    if (!suggested || !hasBackend()) return;
    void ipc
      .summaryModels()
      .then((m) => setBytes(m.recommended.find((r) => r.name === suggested)?.approxBytes ?? null))
      .catch(() => {});
  }, [suggested]);

  useEffect(() => {
    if (!suggested) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onSummaryPull((p) => {
      if (!disposed && p.model === suggested) setPercent(p.percent);
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [suggested]);

  const pull = () => {
    if (!suggested) return;
    setPercent(0);
    void ipc
      .pullSummaryModel(suggested)
      .then(onDone)
      .catch((e) => {
        onFailure(String(e));
        setPercent(null);
      });
  };

  return { bytes, percent, pull };
}

function loadDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}
