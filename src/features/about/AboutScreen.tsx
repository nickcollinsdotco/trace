import { useEffect, useState } from "react";
import { Section } from "../../components/ui/terminal";
import { type AppInfo, type Folder, hasBackend, ipc } from "../../lib/ipc";
import { Diagnostics } from "../diagnostics/Diagnostics";

const FOLDERS: Array<{ kind: Folder; label: string; note: string }> = [
  { kind: "notes", label: "Notes", note: "Your meetings, as Markdown" },
  { kind: "models", label: "Models", note: "Downloaded speech models" },
  { kind: "logs", label: "Logs", note: "The event log in the report below" },
];

/**
 * What this build is, where it keeps things, and what has happened lately.
 *
 * The folders are listed because TRACE's promise is that everything lives on
 * this machine — and the honest way to back that up is to show where.
 */
export function AboutScreen() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [opened, setOpened] = useState<Partial<Record<Folder, string>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasBackend()) return;
    void ipc
      .appInfo()
      .then(setInfo)
      .catch(() => {});
  }, []);

  return (
    <div data-mode="reading" className="h-full overflow-y-auto">
      <div className="trace-measure flex flex-col gap-8 px-6 py-10">
        <Section title="About">
          <p className="text-sm text-ink-muted">
            TRACE records meetings and writes notes entirely on this computer. No audio, transcript
            or note leaves it.
          </p>
          {info && (
            <p className="font-mono text-xs text-ink">
              Version {info.version}
              {info.devBuild && <span className="text-warn"> · development build</span>}
            </p>
          )}
          {/* Here because this is where someone checking their version looks
              next for how to get a newer one. */}
          <p className="text-sm text-ink-muted">
            To update, open PowerShell in the trace folder and run{" "}
            <code data-selectable className="font-mono text-xs text-ink">
              pnpm update-app
            </code>
            . Add{" "}
            <code data-selectable className="font-mono text-xs text-ink">
              -Check
            </code>{" "}
            to see what an update would bring without changing anything.
          </p>
        </Section>

        <Section title="Folders">
          <div className="flex flex-col gap-2">
            {FOLDERS.map((f) => (
              <div key={f.kind} className="flex items-center gap-4">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-mono text-2xs uppercase tracking-system text-ink-faint">
                    {f.label}
                  </span>
                  <span data-selectable className="truncate font-mono text-xs text-ink">
                    {opened[f.kind] ?? f.note}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={!hasBackend()}
                  onClick={() => {
                    setError(null);
                    void ipc
                      .openFolder(f.kind)
                      .then((path) => setOpened((o) => ({ ...o, [f.kind]: path })))
                      .catch((e) => setError(String(e)));
                  }}
                  className="shrink-0 rounded-sm border border-line-strong px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-ink trace-press hover:border-phosphor hover:text-phosphor disabled:opacity-50"
                >
                  Open
                </button>
              </div>
            ))}
            {error && <p className="font-mono text-2xs text-error">&gt; {error}</p>}
          </div>
        </Section>

        <Diagnostics />
      </div>
    </div>
  );
}
