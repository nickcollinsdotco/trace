import { useCallback, useEffect, useState } from "react";
import { Section, SystemLabel } from "../../components/ui/terminal";
import { formatBytes } from "../../lib/format";
import { type DiagnosticsReport, hasBackend, ipc } from "../../lib/ipc";
import { describeLlm, describeLoaded, describeRetention, formatReport } from "./report";

/**
 * Everything worth knowing when something has gone wrong, and a way to send it.
 *
 * A section of the About page rather than a screen: it is what someone looks
 * for when asked "what version, what machine, what happened?".
 *
 * Built so a bug report is one click rather than a screenshot of an error:
 * the version, the machine, the state of both models, and the recent event
 * log, as text that pastes cleanly into a message. The exact text is shown
 * before it is copied, because the person sending it should be able to see
 * everything that leaves their machine.
 */
export function Diagnostics() {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  const load = useCallback(() => {
    if (!hasBackend()) return;
    setError(null);
    setCopied("idle");
    void ipc
      .diagnosticsReport()
      .then(setReport)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => load(), [load]);

  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(formatReport(report));
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <>
      <Section title="Diagnostics">
        <p className="text-sm text-ink-muted">
          When something goes wrong, copy this report and paste it into a message. It holds no
          audio, transcripts or notes — though an error message can quote a few words the model
          wrote, so skim it before sending.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copy}
            disabled={!report}
            className="rounded-sm border border-phosphor px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-phosphor trace-press hover:bg-phosphor hover:text-surface-0 disabled:opacity-50"
          >
            Copy report
          </button>
          <button
            type="button"
            onClick={load}
            className="font-mono text-2xs uppercase tracking-system text-ink-faint trace-press hover:text-ink"
          >
            Refresh
          </button>
        </div>
        {copied === "copied" && (
          <p role="status" className="font-mono text-2xs text-phosphor">
            &gt; copied — paste it into your message.
          </p>
        )}
        {copied === "failed" && (
          <p role="status" className="font-mono text-2xs text-warn">
            &gt; the clipboard refused. Open “Report as text” below and copy it from there.
          </p>
        )}
        {error && <p className="font-mono text-2xs text-error">&gt; {error}</p>}
      </Section>

      {!hasBackend() ? (
        <p className="font-mono text-xs text-ink-faint">&gt; no backend — run the desktop app.</p>
      ) : report === null ? (
        <p className="font-mono text-xs text-ink-faint">&gt; reading machine…</p>
      ) : (
        <>
          <Section title="Machine">
            <Rows
              rows={[
                ["OS", report.os],
                ["Processor", `${report.cpu}, ${report.threads} threads`],
                ["Memory", formatBytes(report.memoryBytes)],
              ]}
            />
          </Section>

          <Section title="Transcription">
            <Rows
              rows={[
                [
                  "Model",
                  `${report.speechModel}${report.speechInstalled ? "" : " — not installed"}`,
                ],
                ["Runs on", report.accelerator],
                ["Keep audio", describeRetention(report.audioRetention)],
              ]}
            />
          </Section>

          <Section title="Summaries">
            <Rows
              rows={[
                ["Ollama", report.ollamaVersion ?? "not reachable"],
                ["State", describeLlm(report.llm)],
                ["Preference", report.preferredModels.join(", ")],
                ["Context", `${report.contextTokens} tokens`],
                [
                  "Memory",
                  report.summaryMemory === "while_writing"
                    ? "loaded only while writing notes"
                    : "loaded during meetings",
                ],
                [
                  "In memory",
                  report.loadedModels.length === 0
                    ? "none"
                    : report.loadedModels.map(describeLoaded).join("\n"),
                ],
              ]}
            />
          </Section>

          <Section title="Recent events">
            {report.recent.length === 0 ? (
              <p className="font-mono text-xs text-ink-faint">&gt; nothing logged yet.</p>
            ) : (
              <pre
                data-selectable
                className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-line bg-surface-1 p-3 font-mono text-2xs leading-relaxed text-ink-muted"
              >
                {/* Newest first on screen, where the eye starts; the copied
                      report keeps log order, which is how it is read back. */}
                {[...report.recent].reverse().join("\n")}
              </pre>
            )}
          </Section>

          <details>
            <summary className="inline-flex w-fit cursor-pointer list-none rounded-xs">
              <SystemLabel tone="muted">Report as text</SystemLabel>
            </summary>
            <pre
              data-selectable
              className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-line bg-surface-1 p-3 font-mono text-2xs leading-relaxed text-ink-muted"
            >
              {formatReport(report)}
            </pre>
          </details>
        </>
      )}
    </>
  );
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-mono text-2xs uppercase tracking-system text-ink-faint">{label}</dt>
          <dd
            data-selectable
            className="min-w-0 whitespace-pre-line break-words font-mono text-xs text-ink"
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
