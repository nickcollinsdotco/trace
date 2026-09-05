import { useEffect, useState } from "react";
import { BootLine, SystemLabel } from "../components/ui/terminal";
import { hasBackend, ipc, type ModelProgress, type ModelStatus, onModelProgress } from "../lib/ipc";

/**
 * Speech-model status, and the download when it is missing.
 *
 * The models are far too large to ship in the installer, so a first-run
 * download is unavoidable. That makes it the honest place for the boot
 * sequence from docs/09-EASTER-EGGS.md — real progress wearing the fiction's
 * clothes, rather than decoration bolted onto a screen that had nothing to say.
 */
export function ModelGate() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [progress, setProgress] = useState<ModelProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!hasBackend()) return;
    void ipc
      .modelStatus()
      .then(setStatus)
      .catch(() => {});

    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onModelProgress((p) => {
      if (disposed) return;
      setProgress(p);
      if (p.phase === "done") {
        setProgress(null);
        void ipc
          .modelStatus()
          .then(setStatus)
          .catch(() => {});
      }
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!hasBackend() || !status) return null;

  if (status.installed && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-2"
        title={status.directory}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-phosphor" />
        <SystemLabel>Ready</SystemLabel>
      </button>
    );
  }

  if (status.installed && expanded) {
    return (
      <div className="flex items-center gap-3">
        <BootLine label="transcription engine" state="ok" />
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="font-mono text-2xs text-ink-faint hover:text-ink"
        >
          ×
        </button>
      </div>
    );
  }

  if (progress) {
    return (
      <div className="flex min-w-64 items-center gap-3">
        <BootLine label={progress.phase} state={progress.phase === "done" ? "ok" : "active"} />
        <span className="font-mono text-2xs tabular-nums text-phosphor">{progress.percent}%</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <SystemLabel tone="muted">No speech model</SystemLabel>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setProgress({ phase: "downloading", percent: 0 });
          void ipc.installModel().catch((e) => {
            setError(String(e));
            setProgress(null);
          });
        }}
        className="rounded-sm border border-phosphor px-2.5 py-1 font-mono text-2xs uppercase tracking-system text-phosphor transition-colors duration-120 hover:bg-phosphor hover:text-surface-0"
      >
        Download ({Math.round(status.downloadBytes / 1_048_576)} MB)
      </button>
      {error && <span className="font-mono text-2xs text-error">{error}</span>}
    </div>
  );
}
