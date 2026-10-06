import { useEffect, useRef, useState } from "react";
import { Page } from "../../components/ui/Page";
import { Prompt, Section } from "../../components/ui/terminal";
import { type AppInfo, type Folder, hasBackend, ipc } from "../../lib/ipc";
import { Diagnostics } from "../diagnostics/Diagnostics";
import { WhatsNew } from "./WhatsNew";

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
export function AboutScreen({
  focus,
}: {
  /** Opened to read this, from the status bar or the palette. */
  focus?: "whats-new" | undefined;
} = {}) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const whatsNew = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus === "whats-new") whatsNew.current?.scrollIntoView?.({ block: "start" });
  }, [focus]);
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
    <Page
      title="About"
      lead="TRACE records meetings and writes notes entirely on this computer. No audio, transcript or note leaves it."
      className="gap-8"
    >
      <Section title="Version">
        {info && (
          <p className="font-mono text-xs text-ink">
            TRACE {info.version}
            {info.devBuild && <span className="text-warn"> · development build</span>}
          </p>
        )}
        {/* Here because this is where someone checking their version looks
            next for how to get a newer one. Two audiences: most people have
            an installer, the developer builds from the folder. */}
        <p className="text-sm text-ink-muted">
          TRACE never checks for updates by itself — it does not go online on its own. New versions
          are published on GitHub; install one over this and your notes stay where they are.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!hasBackend()}
            onClick={() => void ipc.openLink("releases").catch((e) => setError(String(e)))}
            className="trace-btn trace-btn-secondary trace-press disabled:opacity-50"
          >
            Releases on GitHub <span aria-hidden>↗</span>
          </button>
        </div>
        <p className="text-xs text-ink-faint">
          Built from source? In the trace folder, run{" "}
          <code data-selectable className="font-mono text-ink-muted">
            pnpm update-app
          </code>
          , or add{" "}
          <code data-selectable className="font-mono text-ink-muted">
            -Check
          </code>{" "}
          to see what it would bring first.
        </p>
      </Section>

      {/* Second, after the version it describes: an update is the moment
          someone comes here, and this is what they came for. */}
      <div ref={whatsNew} className="scroll-mt-16">
        <WhatsNew />
      </div>

      <Section title="Folders">
        <div className="flex flex-col gap-2">
          {FOLDERS.map((f) => (
            <div key={f.kind} className="flex items-center gap-4">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-mono text-2xs trace-caps-label tracking-system text-ink-faint">
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
                className="shrink-0 trace-btn trace-btn-secondary trace-press disabled:opacity-50"
              >
                Open
              </button>
            </div>
          ))}
          {error && (
            <p className="font-mono text-2xs text-error">
              <Prompt />
              {error}
            </p>
          )}
        </div>
      </Section>

      <Diagnostics />
    </Page>
  );
}
