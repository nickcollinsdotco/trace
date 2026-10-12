import { useEffect, useState } from "react";
import { Gauge } from "../components/ui/terminal";
import { ipc, onUpdateFailed, onUpdateProgress } from "../lib/ipc";

/** Where an update has got to, as the status bar shows it. */
export type UpdateView =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "installing"; version: string }
  | { kind: "failed"; message: string; version?: string };

/** What would be lost if TRACE closed to install now. */
export type UpdateBlock = "recording" | "writing";

/** Said in place of the download button while it waits, and why on hover. */
const WAITING: Record<UpdateBlock, { label: string; why: string }> = {
  recording: {
    label: "after this meeting",
    why: "Installing closes TRACE, which would end the recording. It can install once the meeting has stopped.",
  },
  writing: {
    label: "once the notes are written",
    why: "Installing closes TRACE, which would stop the notes part-way. It can install once they are written.",
  },
};

/** How long "up to date" stays before the bar goes back to the version alone. */
const CURRENT_MS = 4_000;

/**
 * The version, which is also the button that checks for a newer one.
 *
 * A click is the only thing that checks: TRACE does not go online on its
 * own, and the version is where someone wondering whether they are behind
 * already looks. What it found sits beside it in words, and "update
 * available" is itself the button that fetches it, with the progress shown
 * in its place — one spot on the bar from asking to installing.
 */
export function UpdateEntry({
  version,
  blocked = null,
  initial = { kind: "idle" },
}: {
  version: string;
  /**
   * Why installing now would lose something — a meeting recording, notes
   * being written — or null. Installing closes TRACE, so the download waits;
   * the backend refuses too, this only says so before the click.
   */
  blocked?: UpdateBlock | null;
  /** For the gallery, to open on a state that otherwise takes a click. */
  initial?: UpdateView | undefined;
}) {
  const [view, setView] = useState<UpdateView>(initial);

  useEffect(() => {
    if (view.kind !== "current") return;
    const id = window.setTimeout(() => setView({ kind: "idle" }), CURRENT_MS);
    return () => window.clearTimeout(id);
  }, [view.kind]);

  useEffect(() => {
    if (view.kind !== "downloading") return;
    const unlisten = onUpdateProgress(({ percent }) =>
      setView((v) => (v.kind === "downloading" ? { ...v, percent } : v)),
    );
    return () => {
      void unlisten.then((f) => f());
    };
  }, [view.kind]);

  // The command has answered by now, so an installer that would not start
  // can only say so this way.
  useEffect(() => {
    if (view.kind !== "installing") return;
    const next = view.version;
    const unlisten = onUpdateFailed(({ message }) =>
      setView({ kind: "failed", message, version: next }),
    );
    return () => {
      void unlisten.then((f) => f());
    };
  }, [view]);

  const check = () => {
    setView({ kind: "checking" });
    void ipc
      .checkForUpdate()
      .then(({ latest }) =>
        setView(latest ? { kind: "available", version: latest } : { kind: "current" }),
      )
      .catch((e) => setView({ kind: "failed", message: String(e) }));
  };

  const install = (next: string) => {
    setView({ kind: "downloading", version: next, percent: 0 });
    void ipc
      .installUpdate()
      .then(() => setView({ kind: "installing", version: next }))
      .catch((e) => setView({ kind: "failed", message: String(e), version: next }));
  };

  // Busy from the first byte until TRACE closes: a second click must not
  // start a second download, or check over the top of one.
  const busy =
    view.kind === "checking" || view.kind === "downloading" || view.kind === "installing";

  return (
    <>
      {view.kind === "checking" && <span>checking…</span>}
      {view.kind === "current" && <span role="status">up to date</span>}
      {view.kind === "available" &&
        (blocked ? (
          <span role="status" title={WAITING[blocked].why}>
            update v{view.version} {WAITING[blocked].label}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => install(view.version)}
            title={`Download TRACE ${view.version} and install it. TRACE restarts to finish.`}
            className="rounded-xs px-1 text-phosphor trace-press hover:underline"
          >
            update available · v{view.version}
          </button>
        ))}
      {view.kind === "downloading" && (
        <span className="flex items-center gap-2" role="status">
          <span>v{view.version}</span>
          <Gauge
            value={view.percent / 100}
            label={`Downloading ${view.percent}%`}
            className="w-20"
          />
          <span className="w-8 text-right tabular-nums">{Math.round(view.percent)}%</span>
        </span>
      )}
      {view.kind === "installing" && (
        <span role="status" className="text-phosphor">
          restarting to install v{view.version}…
        </span>
      )}
      {view.kind === "failed" &&
        (view.version ? (
          <button
            type="button"
            onClick={() => view.version && install(view.version)}
            title={view.message}
            className="rounded-xs px-1 text-warn trace-press hover:underline"
          >
            download failed · retry
          </button>
        ) : (
          <span role="status" className="text-warn" title={view.message}>
            couldn't check
          </span>
        ))}
      <button
        type="button"
        onClick={check}
        disabled={busy}
        title="Check for updates"
        className="rounded-xs trace-press enabled:hover:text-ink"
      >
        v{version}
      </button>
    </>
  );
}
