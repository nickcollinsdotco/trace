import { useEffect, useState } from "react";
import {
  hasBackend,
  ipc,
  type ModelProgress,
  onModelProgress,
  type SystemReport,
} from "../../lib/ipc";

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
      data-case="upper"
      className="flex h-full items-center justify-center overflow-y-auto bg-surface-0 px-6 py-10"
    >
      <div className="w-full max-w-2xl border border-line-strong">
        <TapeStrip />

        <div className="border-b border-line-strong px-6 py-5 text-center">
          <h1 className="text-xl tracking-[0.3em] text-ink">TRACE</h1>
          <p className="mt-1 font-mono text-2xs tracking-system text-ink-muted">
            First run · machine report
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
              <Row label="Memory" value={bytes(report.memoryBytes)} />
              <Row label="Inference" value={report.accelerator} />
            </Group>

            <Group>
              <Row label="Model" value={report.modelName} />
              <Row label="Download" value={bytes(report.modelBytes)} />
              <Row label="Target" value={report.modelDir} wrap />
              {report.diskFreeBytes !== null && (
                <Row label="Free" value={`${bytes(report.diskFreeBytes)} available`} />
              )}
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
                      [ Install ]
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

function Row({ label, value, wrap }: { label: string; value: React.ReactNode; wrap?: boolean }) {
  return (
    <div className="flex items-baseline">
      <span className="w-36 shrink-0 self-stretch border-r border-line-strong px-6 py-2 font-mono text-2xs tracking-system text-ink-muted">
        {label}
      </span>
      <span
        data-selectable
        className={`min-w-0 flex-1 px-6 py-2 font-mono text-xs text-ink ${
          wrap ? "break-all" : "truncate"
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

/** Binary units, because that is what a disk and a download are measured in. */
function bytes(n: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
