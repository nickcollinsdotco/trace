import { useEffect, useState } from "react";
import { useLlmStatus } from "../features/llm/useLlmStatus";
import { type AppInfo, hasBackend, ipc, type ModelStatus } from "../lib/ipc";

/**
 * The bottom bar: which models are in play, and which build this is.
 *
 * Both models are shown because they fail independently — transcription can
 * be perfect while summaries are offline, and the notes screen is not where
 * anyone should first learn that. Either entry opens diagnostics, which says
 * why in full.
 */
export function StatusBar({ onOpenDiagnostics }: { onOpenDiagnostics: () => void }) {
  const [speech, setSpeech] = useState<ModelStatus | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const { status: llm } = useLlmStatus();

  useEffect(() => {
    if (!hasBackend()) return;
    void ipc
      .modelStatus()
      .then(setSpeech)
      .catch(() => {});
    void ipc
      .appInfo()
      .then(setInfo)
      .catch(() => {});
  }, []);

  if (!hasBackend()) return null;

  const summary =
    llm === null
      ? null
      : llm.state === "ready"
        ? { tone: "ok" as const, text: llm.model, title: "Summaries are written by this model" }
        : llm.state === "no_model"
          ? { tone: "warn" as const, text: "No summary model", title: "Ollama has no model" }
          : { tone: "warn" as const, text: "Ollama closed", title: "Summaries need Ollama open" };

  return (
    <footer className="flex shrink-0 items-center gap-5 border-t border-line px-5 py-1.5 font-mono text-2xs text-ink-muted">
      {speech && (
        <Entry
          tone={speech.installed ? "ok" : "warn"}
          title="Transcribes the meeting on this machine"
          onClick={onOpenDiagnostics}
        >
          {speech.installed ? speech.name : "No speech model"}
        </Entry>
      )}
      {summary && (
        <Entry tone={summary.tone} title={summary.title} onClick={onOpenDiagnostics}>
          {summary.text}
        </Entry>
      )}

      <span className="ml-auto flex items-center gap-2 text-ink-faint">
        {info?.devBuild && <span className="text-warn">dev</span>}
        {info && <span>v{info.version}</span>}
      </span>
    </footer>
  );
}

function Entry({
  tone,
  title,
  onClick,
  children,
}: {
  tone: "ok" | "warn";
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex min-w-0 items-center gap-2 rounded-xs trace-press hover:text-ink"
    >
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${tone === "ok" ? "bg-phosphor" : "bg-warn"}`}
      />
      <span className={`truncate ${tone === "warn" ? "text-warn" : ""}`}>{children}</span>
    </button>
  );
}
