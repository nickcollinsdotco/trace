import { useEffect, useState } from "react";
import { formatBytes } from "../../lib/format";
import {
  hasBackend,
  ipc,
  type LlmStatus,
  type ModelProgress,
  onModelProgress,
  type SystemReport,
} from "../../lib/ipc";
import { useLlmStatus } from "../llm/useLlmStatus";

/**
 * First run, as a machine report.
 *
 * TRACE has something genuinely unavoidable to do here — fetch a ~456 MB
 * speech model — and a bare progress bar wastes the one moment the user is
 * actually paying attention. So the screen answers the two questions somebody
 * really has on first run: *can my machine do this*, and *what are you putting
 * on my disk*.
 *
 * Every row is measured. Nothing is invented to fill the table, and the
 * inference row says CPU because that is what runs — see `system.rs`.
 *
 * Always rendered in the `report` look, whatever theme is chosen afterwards.
 * There is no chosen theme yet at first run, and this form is the one the
 * content asks for: TRACE genuinely is a machine report about the machine it
 * is about to run on.
 */
export function FirstRunScreen({ onReady }: { onReady: () => void }) {
  const [report, setReport] = useState<SystemReport | null>(null);
  const [progress, setProgress] = useState<ModelProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const llm = useLlmStatus();

  useEffect(() => {
    if (!hasBackend()) return;
    void ipc
      .systemReport()
      .then(setReport)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!hasBackend()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void onModelProgress((p) => {
      if (disposed) return;
      setProgress(p);
      if (p.phase === "done") onReady();
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onReady]);

  function install() {
    setError(null);
    setProgress({ phase: "downloading", percent: 0 });
    void ipc.installModel().catch((e) => {
      setError(String(e));
      setProgress(null);
    });
  }

  return (
    <div
      data-theme="report"
      data-frame="box"
      data-mono="plex"
      data-type="mono"
      data-case="headings"
      // A machine report, all of it in capitals: one fixed look, not a
      // theme, so it says so itself rather than through the case ladder.
      // Centred by the report's own auto margins, not by the flex box:
      // centred that way, a report taller than the window lost its top above
      // the scroll, where no scrolling could reach it.
      className="flex h-full flex-col overflow-y-auto bg-surface-0 px-6 py-6 uppercase [scrollbar-gutter:stable_both-edges]"
    >
      <div className="m-auto w-full max-w-2xl border border-line-strong">
        <TapeStrip />

        <div className="border-b border-line-strong px-6 py-4 text-center">
          <h1 className="text-xl tracking-[0.3em] text-ink">TRACE</h1>
          <p className="mt-1 font-mono text-2xs tracking-system text-ink-muted">
            First run · machine report
          </p>
          {/* Said once, before the table: the report answers "can this
              machine do it", and someone new first needs "do what". */}
          <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-ink-muted normal-case">
            Records your meetings, transcribes them and writes the notes — all on this machine. One
            speech model is needed before the first meeting.
          </p>
        </div>

        {report === null ? (
          <p className="px-6 py-10 text-center font-mono text-xs text-ink-faint">
            {error ?? "reading machine…"}
          </p>
        ) : (
          <>
            <Group>
              <Row label="Host" value={report.host} />
              <Row label="OS" value={report.os} />
              {report.kernel && <Row label="Build" value={report.kernel} />}
            </Group>

            <Group>
              <Row label="Processor" value={report.cpu} />
              <Row
                label="Cores"
                value={
                  report.cores
                    ? `${report.cores} core / ${report.threads} thread`
                    : `${report.threads} thread`
                }
              />
              <Row label="Memory" value={formatBytes(report.memoryBytes)} />
              <Row label="Inference" value={report.accelerator} />
            </Group>

            <Group>
              <Row label="Model" value={report.modelName} />
              <Row label="Download" value={formatBytes(report.modelBytes)} />
              <Row label="Target" value={report.modelDir} wrap="anywhere" />
              {report.diskFreeBytes !== null && (
                <Row label="Free" value={`${formatBytes(report.diskFreeBytes)} available`} />
              )}
            </Group>

            {/* Summaries are Ollama's, and optional: a transcript is written
                without it. Reported here so the first meeting's missing
                summary is not the first anyone hears of it. */}
            <Group>
              <Row label="Summaries" value={<Summaries status={llm.status} />} wrap="words" />
            </Group>

            <Group last>
              {progress ? (
                <Row label={progress.phase} value={<Gauge percent={progress.percent} />} />
              ) : (
                <Row
                  label="Status"
                  value={
                    <button
                      type="button"
                      onClick={install}
                      disabled={!hasBackend()}
                      className="border border-line-strong px-4 py-1.5 font-mono text-2xs tracking-system text-ink trace-press hover:bg-ink hover:text-surface-0 disabled:opacity-40"
                    >
                      [ Download speech model ]
                    </button>
                  }
                />
              )}
            </Group>

            {error && (
              <p className="border-t border-line-strong px-6 py-4 font-mono text-2xs leading-relaxed text-error">
                {error}
              </p>
            )}

            <p className="border-t border-line-strong px-6 py-3 font-mono text-2xs leading-relaxed text-ink-faint">
              Downloaded once. TRACE runs entirely offline afterwards, and no audio ever leaves this
              machine.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Ollama's state, in the report's terse voice, with the way to get it. */
function Summaries({ status }: { status: LlmStatus | null }) {
  if (status === null) return <span className="text-ink-faint">checking…</span>;
  switch (status.state) {
    case "ready":
      return <span>Ollama · {status.model}</span>;
    case "no_model":
      return <span>Ollama · no model yet — choose one later, under models</span>;
    case "not_running":
      return <span>Ollama · installed, not running</span>;
    case "not_installed":
      return (
        <span className="flex flex-col items-start gap-2 normal-case">
          <span className="uppercase">Ollama · not found</span>
          <span className="font-sans text-2xs leading-relaxed text-ink-muted">
            Optional: a free app that runs AI models on this computer. Transcripts work without it;
            the summary and action items need it.
          </span>
          <button
            type="button"
            onClick={() => void ipc.openLink("ollama").catch(() => {})}
            className="border border-line-strong px-3 py-1 font-mono text-2xs tracking-system text-ink trace-press hover:bg-ink hover:text-surface-0"
          >
            [ Get Ollama ↗ ]
          </button>
        </span>
      );
  }
}

/**
 * The perforated strip across the top of the report.
 *
 * Pure CSS: a repeating gradient rather than an image, so it stays crisp at
 * any width and costs nothing to ship.
 */
function TapeStrip() {
  return (
    <div
      aria-hidden
      className="h-6 border-b border-line-strong"
      style={{
        backgroundImage:
          "repeating-linear-gradient(90deg, var(--color-ink) 0 6px, transparent 6px 12px)",
      }}
    />
  );
}

function Group({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return <div className={last ? "" : "border-b border-line-strong"}>{children}</div>;
}

function Row({
  label,
  value,
  wrap,
}: {
  label: string;
  value: React.ReactNode;
  /** A path breaks anywhere; prose only between words. */
  wrap?: "anywhere" | "words";
}) {
  return (
    <div className="flex items-baseline">
      <span className="w-36 shrink-0 self-stretch border-r border-line-strong px-6 py-1.5 font-mono text-2xs tracking-system text-ink-muted">
        {label}
      </span>
      <span
        data-selectable
        className={`min-w-0 flex-1 px-6 py-1.5 font-mono text-xs text-ink ${
          wrap === "anywhere" ? "break-all" : wrap === "words" ? "break-words" : "truncate"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * A dithered progress bar, in the TR-100's own idiom.
 *
 * The track is a checkerboard and the fill is solid, so the two read apart
 * without relying on colour — which this screen does not have.
 */
function Gauge({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <span className="flex items-center gap-3">
      <span
        className="trace-fill h-3.5 flex-1"
        style={{ "--fill": clamped / 100 } as React.CSSProperties}
      />
      <span className="w-10 shrink-0 text-right tabular-nums">{clamped}%</span>
    </span>
  );
}
